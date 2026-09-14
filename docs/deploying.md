# Deploying SharePix

Everything that has to be true for production to work, and the handful of things
that cannot be set from this repository.

## The shape of a deploy

Amplify Hosting builds from a Git branch. `amplify.yml` runs
`ampx pipeline-deploy` for the backend and `npm run build` for the frontend, so
every push to the connected branch redeploys both. There is no separate backend
deploy step and no manual CloudFormation.

First time:

1. Push the repository to GitHub.
2. AWS console → **Amplify** → **Create new app** → connect the repo and branch.
3. Set the secrets and environment variables below **before** the first build.
   A build without them succeeds and produces a site that cannot take payment.
4. **Hosting → Custom domains** → add `sharepix.net`.

## Secrets

Three, and they are Amplify *secrets* rather than environment variables —
`secret()` in the function's `resource.ts`, set with
`npx ampx sandbox secret set NAME` for a sandbox, or under **Hosting →
Secrets** for a branch.

| Secret | Used by |
| --- | --- |
| `STRIPE_SECRET_KEY` | `stripe-checkout`, `print-checkout` |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` |
| `PRODIGI_API_KEY` | `print-checkout`, `print-fulfill` |

They are secrets and not environment variables because an environment variable
is readable from the Amplify console by anyone with console access, and these
three move money.

## Environment variables

Set on the Amplify app (**Hosting → Environment variables**). Everything ending
in `_TABLE_NAME` or `_BUCKET_NAME` is wired by `amplify/backend.ts` from the
resources it creates — do not set those by hand.

### Required for a working production site

| Variable | What happens without it |
| --- | --- |
| `APP_URL` | Defaults to `https://www.sharepix.net`. Set it for any other branch, or emails and QR codes will point at production. |
| `R2_ACCOUNT_ENDPOINT` | |
| `R2_BUCKET` | Reads fall back to S3. Everything works and egress costs a great deal more — see [r2-hybrid.md](r2-hybrid.md). |
| `R2_ACCESS_KEY_ID` | |
| `R2_SECRET_ACCESS_KEY` | |
| `ALERT_FROM_ADDRESS` | A verified SES identity. Without it no transactional email can be sent at all. |
| `ALERT_REPLY_TO` | Replies go to the from-address. |
| `ALERT_EMAIL` | Nobody is paged when a Lambda starts failing — see [alerting.md](alerting.md). |
| `REPORT_TO_ADDRESS` | The monthly report is generated and sent nowhere. |

### Frontend, and therefore baked in at build time

| Variable | What happens without it |
| --- | --- |
| `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` | No page views are counted anywhere. `pages/_app.tsx` renders nothing rather than a beacon with an empty token, so the site works fine and you are blind. |

`NEXT_PUBLIC_*` is compiled into the JavaScript bundle, not read at run time.
Setting it and **not redeploying** does nothing, which is a confusing half hour
if you do not know it.

### Switches, all off by default

These ship unset on purpose. Each one does something you want to have decided
deliberately rather than inherited.

| Variable | Set to | Effect |
| --- | --- | --- |
| `EMAIL_SENDING_ENABLED` | `true` | Actually sends. Unset, every send is a dry run that logs what it would have sent and returns a count. **Watch the first production run.** |
| `STORAGE_RECLAIM_ENABLED` | `true` | Lets the reclaim job delete expired events' bytes. Unset, it decides, logs every key it would remove, and deletes nothing. The only job that destroys data, and its own switch for that reason. |
| `WAF_ENABLED` | anything | Rate limiting in front of the API. About $7/month before traffic, whether or not anyone attacks — see `amplify/waf.ts` for when it is worth paying. |

### Tuning, with sensible defaults

| Variable | Default |
| --- | --- |
| `S3_COPY_RETENTION_DAYS` | `90` |
| `RATING_DELAY_DAYS` | `2` |
| `RESEARCH_SURVEY_DELAY_DAYS` | `7` |
| `RESEARCH_SURVEY_ID` | `post-event-v1` |
| `RESEARCH_SURVEY_URL` | unset — no survey invite is sent |
| `RESEARCH_FULFILMENT_DAYS` | unset |

## The domain

`www.sharepix.net` is the canonical host. Every link the product mints says so:
`APP_URL` in the backend, the canonical tags from `lib/seo.ts`, the QR codes
(which read `window.location.origin`), the printed table tents and brochures.

In **Hosting → Custom domains**, tick **"Setup redirect from
https://sharepix.net to https://www.sharepix.net"**.

Do *not* use "Include root" to serve both. QR codes are printed from whichever
host the dashboard was open on, so serving both hostnames means printed codes
split across two origins with no way to tell from the paper which one a given
card carries. One host, one redirect.

Once the redirect is live, submit `https://www.sharepix.net/sitemap.xml` in
Google Search Console.

## Steps that are not in this repository

Nothing here can set these, and each one is silently wrong until it is done.

### Stripe

**The webhook.** Dashboard → Developers → Webhooks → add an endpoint pointing at
the `stripe-webhook` function URL. `STRIPE_WEBHOOK_SECRET` must match the
signing secret that endpoint shows. Without it a customer pays and their event
is never activated, which is the single worst failure in the product.

**Tax: almost certainly nothing to do yet.** `automatic_tax` is already switched
on in `stripe-checkout`, and this is deliberately safe to run with no
registrations at all — Stripe calculates **zero** for any jurisdiction you are
not registered in, so it changes nothing today and starts working the moment a
registration is added, rather than needing a code change at the point somebody
notices a liability.

What that leaves is one question and one tripwire:

- **Settle the home state.** SharePix LLC is registered in Minnesota, and
  physical presence creates nexus regardless of volume — so Minnesota is not
  waiting for a threshold the way every other state is. But "register" here
  means a **sales tax permit with the Minnesota Department of Revenue**, which
  is a different thing from the LLC filing with the Secretary of State. Forming
  the entity does not register you to collect tax.

  The prior question is whether SharePix is taxable in Minnesota at all, and it
  is genuinely not obvious: Minnesota taxes *specified digital products* but
  generally does not tax software delivered as a service, and SharePix can be
  argued into either bucket. That classification decides whether a permit is
  needed at all, so it is worth a Minnesota CPA's time or written guidance from
  the Department before anything is filed.

  **Do not add a Minnesota registration in Stripe until that is settled.** The
  moment one exists, Stripe starts charging Minnesota customers sales tax, and
  over-collecting is its own problem — the money is owed to somebody and it is
  not SharePix.
- **Watch `/global-admin`.** `lib/taxNexus.ts` reads the sales already recorded
  and says when a threshold is approaching — at 80% of the common $100,000 /
  200-transaction economic-nexus line, because registering takes weeks and a
  tripwire that fires on arrival fires too late. It also fires on the **first**
  sale outside the US, with no threshold, because EU VAT on digital services has
  none.

It calculates and collects. It does not file or remit. When the tripwire goes,
that is a conversation with an accountant and possibly a move to a merchant of
record (about 2.4% of revenue), which is exactly why it is a trigger rather than
something done up front.

**Live mode**, when prints go live. Both halves together — see
[go-live-prints.md](go-live-prints.md).

### SES

- Verify `ALERT_FROM_ADDRESS` as an identity.
- Move out of the sandbox, or SES delivers only to verified addresses and every
  guest-facing email silently fails.
- DKIM and a DMARC record, or reminders land in spam.

### Cognito

Add the first administrator to the `ADMINS` group:
`npm run admin:grant -- <email-prefix>`, or in the console. Group membership
rides in the token, so sign out and back in after.

### Cloudflare R2

The bucket, and an access key with read, write **and delete** — reclamation has
to remove the R2 copy as well as the S3 one, or a "deleted" photo is still
reachable from the host that actually serves reads.

### Cloudflare Web Analytics

Free, cookieless, and **does not require moving DNS to Cloudflare** — it is a
JavaScript beacon that works on any host, which is why it suits a site served by
Amplify.

1. dash.cloudflare.com → **Analytics & Logs → Web Analytics** → **Add a site**.
2. Enter `www.sharepix.net`. It hands back a snippet; the only part that matters
   is the `token` value inside it.
3. Amplify → **Hosting → Environment variables** → set
   `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` to that token.
4. **Redeploy.** `NEXT_PUBLIC_*` is compiled into the bundle, so the variable
   does nothing until a build picks it up.

Data starts appearing within a few minutes of the first visit. It counts page
views site-wide — it cannot attribute a view to an event, and the report and
survey docs both say so where a reader might otherwise assume otherwise.

`pages/_app.tsx` renders no script at all when the token is unset, rather than a
beacon with an empty token that would 404 on every page load in development.

### Google Search Console

Free, and the only way to see what SharePix ranks for, what Google has actually
indexed, and whether anything is erroring. **Do the apex redirect first** —
submitting a sitemap of `www` URLs while the apex serves a parked page invites
Google to decide for itself which host is canonical.

1. search.google.com/search-console → **Add property**.
2. Choose **Domain** (not URL prefix) and enter `sharepix.net`. That covers both
   hosts and every subdomain, which is what you want given the redirect.
3. It gives you a TXT record. Add it at the registrar — the same place the
   Amplify DNS records went — then click Verify. DNS can take an hour.
4. **Sitemaps** → submit `sitemap.xml`.
5. Come back in a week or two. The things worth looking at first: **Pages** (how
   many are indexed, and why the rest are not) and **Queries** (what people
   searched before clicking).

`public/sitemap.xml` is generated from `lib/seo.ts` and lists only the pages
that are meant to be public — 52 URLs, mostly help articles. Nothing under
`/event/` is in it, and `robots.txt` disallows those prefixes as well.

### Storage reclamation

The one job that destroys data. It runs weekly on its own schedule already, and
does nothing at all until `STORAGE_RECLAIM_ENABLED` is exactly `true`.

Turn it on in this order:

1. **Dry run first.** `/global-admin → Scheduled jobs → Reclaim expired
   storage`. With the flag off it walks the same events, decides the same
   things, logs every key it would remove, and deletes nothing. The summary says
   which mode it ran in.
2. **Read the number.** On a young deployment it should be zero: an event has a
   60-day upload window, then a 12-month gallery, then a 90-day archive, so
   nothing is eligible until roughly 17 months after it was created. Zero is the
   expected answer and is the best possible moment to switch on a destructive
   job — you are turning it on while it has nothing to do.
3. Set `STORAGE_RECLAIM_ENABLED` to `true` in Amplify, and redeploy.
4. Run it by hand once more and confirm the summary now says it deleted what it
   previously only listed.

If you leave it off, expired events keep their bytes forever and "unlimited
photos" on a one-time payment becomes an unbounded liability. That is the whole
reason the job exists.

### In the app, once

`/global-admin → Report recipient` — where the monthly report goes.

## After a deploy

1. `/` loads and the homepage QR modal opens.
2. Create an event end to end, including payment in Stripe test mode.
3. Upload as a guest from a phone on mobile data, not office wifi.
4. `/event/{id}/admin` → the QR code renders and the table tent prints.
5. `/global-admin → Alert email check` sends a test alert.
6. `/global-admin → Print check` confirms Prodigi answers.
7. `/global-admin → Scheduled jobs` → run the daily job by hand and read the
   count of what it *would* have sent before turning `EMAIL_SENDING_ENABLED` on.

## When a deploy hangs

Almost always a CloudFormation nested-stack cycle. Synthesis does **not** catch
these — the app synthesises cleanly and the deploy sits there.

```
npm run validate:backend
```

`scripts/check-stack-cycles.mjs` names the loop. The usual cause is a function
in the wrong `resourceGroupName`: a function that is an AppSync handler *and*
reads a data table belongs in the `data` group, because bucket grants flow that
way and table grants do not flow back.
