# Serving reads from Cloudflare R2

## Why

Guest downloads are included on every plan and serve full-resolution originals,
so bandwidth scales with the number of *guests*, not the number of events. On S3
that is the dominant cost of running SharePix — roughly **$26 of a $79 Premium
event**, most of it egress at about $0.09/GB.

Cloudflare R2 charges **nothing for egress** and less per GB stored. Modelled
against the real plan limits:

| Plan | Stored | Egress | S3 today | Hybrid |
|------|--------|--------|----------|--------|
| Starter $19 | 0.5 GB | 4 GB | $0.37 | $0.07 |
| Standard $39 | 4.7 GB | 111 GB | $10.44 | $0.79 |
| Premium $79 | 7.8 GB | 263 GB | $26.11 | $2.37 |

Premium margin goes from $53 to about $77.

> Those prices were estimated, not fetched from Cloudflare's pricing page.
> Re-check them before making decisions that depend on the exact figures. The
> object sizes come from the codebase and are reliable.

## The shape: AWS writes, Cloudflare reads

Moving everything to Cloudflare was considered and rejected. A full migration
saves about **$0.76 more per Premium event** than this hybrid — the difference
being the one-off AWS egress charge for copying each object out — and costs a
rewrite of authentication, the database, the API, and the whole moderation
pipeline. The hybrid captures ~97% of the saving for a fraction of the risk.

```
guest upload ──> S3 ──> sanitize-upload (vets, strips GPS)
                              │
                              └──> copy to R2 ──> reads served from here
```

Nothing about the upload path, the vetting, or the moderation pipeline changes.
That is the point: the part most expensive to get wrong is left alone.

## When an object gets copied — and why the timing matters

This is the subtle part, and it lives in `amplify/functions/sanitize-upload/mirror.ts`
with tests in `__tests__/r2-mirror.test.ts`.

An uploaded JPEG or HEIC has its location data stripped **in place**. That
rewrite fires a *second* `ObjectCreated` event carrying `sanitized: 'true'`.

Copying on the first event would put the guest's original — GPS and all — into
R2, and R2 is what gets served. Everything the stripper removes would leak.

So:

| Object | Copied when | Why |
|--------|-------------|-----|
| Preview / thumb | Immediately | Re-encoded by the browser's canvas, so they never carried metadata. These are what the gallery serves. |
| JPEG / HEIC original | **Only on the sanitized rewrite** | The first pass still has GPS in it. |
| Video, PNG original | Immediately | Never rewritten, so waiting would mean never copying it. |
| Rejected upload | Never, and any existing copy is deleted | A disguised or oversize file must not survive where reads are served from. |

A missing `sanitized` flag is read as *not yet stripped*, never as "already
clean" — absent metadata must fail closed.

## Failure behaviour

Every part of the mirror is best-effort and degrades to S3:

- R2 unreachable, credentials wrong, bucket missing → the copy is logged and
  skipped. The photo is already vetted and serveable from S3.
- Any of the four environment variables unset → the mirror never runs at all.
  This is the default, so merging the code changes nothing.

## Turning it on

1. Create a Cloudflare account with R2 enabled and make a bucket.
2. Create an R2 API token scoped to that bucket with read and write.
3. Set four variables on the Amplify app and redeploy:

   | Variable | Example |
   |----------|---------|
   | `R2_ACCOUNT_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
   | `R2_BUCKET` | `sharepix-events` |
   | `R2_ACCESS_KEY_ID` | from the API token |
   | `R2_SECRET_ACCESS_KEY` | from the API token |

4. Upload a photo to a test event and check the Lambda logs for
   `Mirrored to R2`, then confirm the object is in the bucket.
5. **Verify the leak case specifically.** Upload a JPEG that has GPS in it,
   then download the copy *from R2* and confirm the coordinates are gone. If
   they are present, the mirror ran on the wrong pass — stop and fix it before
   going further.

## Serving reads out of R2

The `mediaUrls` query (`amplify/functions/media-url/`) mints **presigned R2
URLs** for a batch of keys after checking, per key, that the caller may have it.
Presigned rather than a public `cdn.sharepix.net` domain: read access was
enforced by `defineStorage.access` through the identity pool, and a public
bucket would drop that entirely, making every photo readable by anyone holding a
URL. The rules that replace it live in `access.ts` and are tested there.

It is batched because a gallery needs one URL per photo. A per-photo query would
mean hundreds of round trips and hundreds of Lambda invocations to open a single
page; one query covers the whole gallery, capped at `MAX_KEYS_PER_REQUEST`.

**There is no existence check.** Signing is local HMAC, so the expensive part of
a HEAD-per-object would be the one thing that doesn't scale to a gallery — and
it isn't needed. A signed URL for an object R2 doesn't have returns 404, and
every caller already treats a failed fetch as "use S3": an image swaps its `src`
(`lib/mediaSource.ts`), a download falls through to `downloadData`. A miss costs
one request and no bytes.

So every read carries two URLs, both signed locally at no per-photo cost:

| Path | Primary | Fallback |
| --- | --- | --- |
| Gallery grid, admin grid | R2 preview/thumb | S3 |
| Enlarged original (host) | R2 original | S3 |
| Live slideshow | R2 preview | S3 |
| Download, ZIP, print order | R2 original | S3 `downloadData` |

The browser settles which one works. When R2 is unconfigured, every primary is
the S3 URL and the fallback is absent — exactly the behaviour that predates all
of this.

## What is not done yet

- **Nothing was backfilled.** Anything uploaded before the mirror went live
  exists only in S3 and is served from there. `rclone` or Cloudflare's Super
  Slurper would move the rest; the fallback means there is no rush.
- **Prodigi still fetches from S3.** The webhook regenerates URLs from the
  stored keys at submission time. Worth confirming Prodigi can fetch a
  presigned R2 URL with one real print order before moving it.
