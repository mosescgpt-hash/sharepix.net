# Upload size limits

| | Limit | Where enforced |
| --- | --- | --- |
| Photos | 25 MB | `lib/validation.ts` (client) + `amplify/functions/sanitize-upload/safety.ts` (server) |
| Videos | 500 MB | same two files |

The client check is a courtesy that gives the guest a readable message. The
**server** check is the real one: `sanitize-upload` re-reads the object's actual
size from the S3 event and deletes anything over the ceiling, because a request
that bypasses the UI can put any size of object in the bucket.

The two constants are duplicated by hand — the Lambda bundle deliberately has no
imports from `lib/`. `__tests__/upload-safety.test.ts` asserts they are equal.
Drift is worse than it looks in the direction where the server is lower: the
upload succeeds, the guest is told it worked, and the trigger silently deletes
the file afterwards.

## Why videos are 500 MB

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

4K/60 is a common default on recent phones, so the old ceiling failed a
perfectly ordinary clip. 500 MB clears a couple of minutes at every setting
except ProRes.

## What a limit does and does not cost

**The ceiling itself costs nothing.** S3 bills for bytes actually stored and
actually delivered, not for the maximum allowed. Raising the cap does not raise
the baseline bill; it raises the worst case if guests start uploading much
larger files.

What is expensive is **playback**, because videos are served straight from S3 —
no transcode, no CloudFront. A gallery tile uses `preload="metadata"`, so idle
browsing is cheap, but every play streams the whole original. Roughly $0.09 per
GB delivered, so one 500 MB clip watched 30 times is about $1.35.

For contrast, stills are cheap because they are resized *before* they reach S3:
the gallery serves 480px thumbnails and the live slideshow serves 1280px
previews, so a whole six-hour reception on one screen is well under $0.20.

**Plan limits count items, not bytes.** A 1,000-upload plan permits 500 GB of
video at this ceiling. Nothing enforces a byte budget per event today; that is
the control to add before raising the video limit again.

## Known consequence: bulk ZIP downloads

`downloadPhotosAsZip` and `downloadEventsAsZip` build the archive in the
browser, holding every file in memory at once. With 500 MB videos a host who
selects a whole event can exhaust the tab's memory. This predates the limit
change but is five times easier to hit now.

The fix is a streaming or server-side archive, or a per-archive byte budget that
skips oversized files and names them. Until then, hosts with long videos should
download in smaller selections.

## Content hashing

Uploads are fingerprinted with SHA-256 so the same file is not stored twice.
Hashing reads the entire file into memory, which a phone will not survive at
half a gigabyte — and an out-of-memory kill takes the tab down rather than
throwing something catchable. Files over `MAX_HASHABLE_BYTES` (100 MB) are
therefore uploaded **without** a hash. Dedup is a convenience, not a gate: the
cost is that the same large clip can be uploaded twice.
