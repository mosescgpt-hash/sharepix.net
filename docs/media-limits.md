# Upload size limits

| | Limit | Where enforced |
| --- | --- | --- |
| Photos | 25 MB | `lib/validation.ts` (client) + `amplify/functions/sanitize-upload/safety.ts` (server) |
| Videos | 250 MB | same two files |

The client check is a courtesy that gives the guest a readable message. The
**server** check is the real one: `sanitize-upload` re-reads the object's actual
size from the S3 event and deletes anything over the ceiling, because a request
that bypasses the UI can put any size of object in the bucket.

The two constants are duplicated by hand — the Lambda bundle deliberately has no
imports from `lib/`. `__tests__/upload-safety.test.ts` asserts they are equal.
Drift is worse than it looks in the direction where the server is lower: the
upload succeeds, the guest is told it worked, and the trigger silently deletes
the file afterwards.

## Why videos are 250 MB

The limit was 100 MB, which rejected a **20-second clip** — a toast, a first
dance. Phones record at these rates (Apple's published figures; Android is
comparable):

| Setting | Per minute | 20 seconds |
| --- | --- | --- |
| 1080p / 30 | ~60 MB | ~20 MB |
| 1080p / 60 | ~90 MB | ~30 MB |
| 4K / 24 | ~135 MB | ~45 MB |
| 4K / 30 | ~170 MB | ~57 MB |
| **4K / 60** | ~400 MB | **~133 MB** |
| ProRes 4K / 30 | ~1.7 GB | ~570 MB |

4K/60 is a common default on recent phones, so the old 100 MB ceiling failed a
perfectly ordinary clip. 250 MB clears roughly 35 seconds at 4K/60, over a
minute at 4K/30, and four minutes at 1080p.

It was briefly 500 MB. The reason for halving it is not storage — that is
pennies either way — but **playback**: a video is sent in full on every play,
so the per-file ceiling multiplies by every view. 250 MB covers "a guest filmed
a moment" without reaching for "a guest filmed the ceremony", and halves what
the biggest clip an event can hold costs each time somebody watches it.

## What a limit does and does not cost

**The ceiling itself costs nothing.** S3 bills for bytes actually stored and
actually delivered, not for the maximum allowed. Raising the cap does not raise
the baseline bill; it raises the worst case if guests start uploading much
larger files.

What is expensive is **playback**, because videos are served straight from S3 —
no transcode, no CloudFront. A gallery tile uses `preload="metadata"`, so idle
browsing is cheap, but every play streams the whole original. Roughly $0.09 per
GB delivered, so one 250 MB clip watched 30 times is about $0.68.

The count of videos is not the cost — the count of *views* is. Five 250 MB
clips sitting in an event cost about $0.03 a month to store. The same five
watched right through by 100 guests is 125 GB out, about $11. The lever that
matters most is therefore **who can play them**, not how many there are.

For contrast, stills are cheap because they are resized *before* they reach S3:
the gallery serves 480px thumbnails and the live slideshow serves 1280px
previews, so a whole six-hour reception on one screen is well under $0.20.

## Videos included per plan

| Plan | Photos | Videos |
| --- | --- | --- |
| Starter ($10) | 100 | 2 |
| Standard ($25) | 1,000 | 10 |
| Premium ($50) | unlimited | 30 |
| Corporate ($149/mo) | unlimited per event | 30 per event |

Photos can be unlimited because they are resized before they are ever served.
Videos cannot: they stream from S3 at full size on every play, so an unlimited
video allowance is an open-ended bill. Counting videos rather than bytes is the
unit a host can understand, and the 250 MB per-file ceiling bounds the bytes
behind each one.

The limit is **stamped onto the event at creation** (`videoLimit`), so changing
the table above never retroactively blocks uploads to an event someone already
paid for. `extraVideoCredits` adds to it for a purchased add-on.

**An event with no `videoLimit` is unlimited by design** — events created before
this existed are not retroactively capped.

### Where it is enforced

`create-event-photo` reserves photo and video slots in a **single conditional
`UpdateItem`**, so a video can never consume a photo slot without also
consuming a video slot. When the condition fails, the handler checks which
ceiling is actually full before choosing the message — naming the wrong one
sends a host to buy the wrong thing.

A limit of **zero** is rejected before the update rather than by a condition:
`attribute_not_exists(videoCount)` is true on an event that has never had a
video, which would let the first one through.

`delete-event-photo` decrements `videoCount` for a video, so deleting a clip
frees a slot — otherwise a host clearing space would find the allowance still
spent.

The upload form mirrors the remaining count so a guest is told before they wait
through an upload that would be refused at the end. That is a courtesy; the
atomic reservation is the enforcement.

## Known consequence: bulk ZIP downloads

`downloadPhotosAsZip` and `downloadEventsAsZip` build the archive in the
browser, holding every file in memory at once. With 250 MB videos a host who
selects a whole event can exhaust the tab's memory. This predates the video
limit changes but is easier to hit than it was at 100 MB.

The fix is a streaming or server-side archive, or a per-archive byte budget that
skips oversized files and names them. Until then, hosts with long videos should
download in smaller selections.

## Content hashing

Uploads are fingerprinted with SHA-256 so the same file is not stored twice.
Hashing reads the entire file into memory, which a phone will not reliably
survive at a couple of hundred megabytes — and an out-of-memory kill takes the
tab down rather than throwing something catchable. Files over `MAX_HASHABLE_BYTES` (100 MB) are
therefore uploaded **without** a hash. Dedup is a convenience, not a gate: the
cost is that the same large clip can be uploaded twice.
