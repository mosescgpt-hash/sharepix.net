# Content screening

Every uploaded still image is screened for explicit content before its record is
written, so a flagged photo is never briefly visible to guests. Screening runs
inside the `create-event-photo` function using Amazon Rekognition
(`DetectModerationLabels`).

## What gets flagged

Deliberately narrow — explicit sexual content and nudity, at **90%+ confidence**.
The policy and its full allow/block lists live in
`amplify/functions/create-event-photo/moderation.ts`, with the reasoning in
`__tests__/moderation.test.ts`.

**Never flagged**, by explicit product decision — these are ordinary at a wedding
and flagging them would train the host to ignore alerts:

- Alcohol (champagne, toasts, bar shots) and tobacco/smoking (cigars)
- Kissing and "non-explicit nudity"
- Swimwear, underwear, revealing clothes, "suggestive"
- Gambling, rude gestures

## What happens to a flagged photo

`moderationStatus` on the Photo record drives everything:

| Status | Meaning | Guests & slideshow | Host |
| --- | --- | --- | --- |
| `ok` | Screened, clean | Visible | Visible |
| `flagged` | Held for review | **Hidden** | Visible, with reasons + Release |
| `released` | Host reviewed and allowed it | Visible | Visible |
| `skipped` | Not screened (video, or screening unavailable) | Visible | Visible |

Enforcement is in the `list-event-photos` function — the single query that serves
the public gallery *and* the live slideshow. The host reads the Photo model
directly through owner auth, so they keep seeing everything. That's how "hidden
from everyone except the host" is achieved without a second code path.

The host releases a flagged photo from the event dashboard; denying it is just
deleting it, which already has its own flow.

## Videos are not screened

Rekognition image moderation covers stills only. Videos are recorded as
`skipped`. They never reach the live slideshow (which is stills-only), but they
**do** appear in the gallery unscreened. Screening video needs Rekognition Video,
which is a different, asynchronous, more expensive API — a deliberate later
decision, not an oversight.

## If screening is unavailable

A Rekognition failure does **not** block the upload. The photo is recorded as
`skipped` and the error is logged, which trips the `sharepix-*-errors` CloudWatch
alarm (see `docs/alerting.md`) so an operator finds out.

This is a deliberate trade-off: an outage that silently blocked every guest's
photo would be worse than briefly showing unscreened ones, and the buffer plus
host visibility still apply. **To fail closed instead** — hold everything for
review when screening is down — change the `catch` in `screenPhoto()` to return
`{ status: 'flagged' }`.

## Host settings

Each event's dashboard has:

- **Photo screening** — *Hold flagged photos for review* (default) or *Show all
  photos immediately*. In the second mode no Rekognition call is made at all, so
  the host isn't paying for screening they turned off. Switching to it does
  **not** auto-release photos already held.
- **Email me when a photo is held** — an optional address for the alert below.

## Alert emails (SES)

When a photo is held and the event has an alert email, the host gets a message
with the **preview embedded** and **Approve / Deny** buttons.

The preview is attached inline (`multipart/related`, referenced by `Content-ID`)
rather than hotlinked, because the app's image URLs are short-lived signed links
that would be broken by the time the message is opened.

**The buttons do not act on their own.** They open `/review/{token}?intent=...`,
which pre-selects the choice and waits for one confirming tap. Mail scanners and
link prefetchers follow URLs in email, so a GET that released a photo would let a
scanner approve it before a human ever looked.

### Setup

1. Verify a domain (or address) in **Amazon SES** and request **production
   access** — a new account is sandboxed and can only send to verified addresses.
2. Set **`ALERT_FROM_ADDRESS`** on the Amplify app to a verified sender, e.g.
   `alerts@sharepix.net`, and redeploy.

Leaving `ALERT_FROM_ADDRESS` unset simply disables the emails — held photos are
still reviewable in the dashboard. Send failures are logged and never block an
upload.

### Why not SMS?

US A2P messaging requires 10DLC brand/campaign registration before any send, and
MMS is needed to include a picture. Email delivers the preview and the buttons
today with no registration; SMS can be added later using the same review link.

## Location metadata (EXIF/GPS)

Phone photos routinely carry the exact GPS coordinates where they were taken,
and that travels with the file whenever an original is downloaded or sent to a
print lab. The `sanitize-upload` trigger strips it.

**Previews and thumbnails were already clean** — the browser re-draws those
through a canvas, which produces a fresh file with no metadata. Only the
**original** needed handling.

### How, and why not the obvious way

Deleting the EXIF block also deletes the **Orientation** tag, and phones rely on
that tag rather than rotating the pixels — drop it and portrait photos display
sideways. Editing the block in place means recomputing every TIFF offset, and one
wrong offset corrupts the file.

So `exif.ts` reads the orientation, discards the entire metadata block, and
rebuilds a **32-byte EXIF containing only that value**. GPS, timestamps, camera
and lens, serial numbers, embedded thumbnails, XMP, IPTC, and comments are gone
*by construction* rather than by blocklist. The compressed image data is copied
through untouched, so there is **no re-encode and no quality loss**.

A photo already upright (orientation 1) gets no EXIF block at all. A file that
looks malformed is left exactly as uploaded.

### Known gap: JPEG only

Only JPEG originals are stripped. **HEIC is not** — that's the iPhone default
unless the phone is set to "Most Compatible", and HEIC stores metadata in ISO
BMFF boxes that need a separate parser. PNG and WebP can also carry metadata and
are likewise untouched.

So coverage today is Android, cameras, and iPhones set to JPEG. Extending it to
HEIC is a worthwhile follow-up, not a small one.

## Cost

Roughly **$1 per 1,000 images** (confirm current Rekognition pricing). A
500-photo wedding is about **$0.50**.
