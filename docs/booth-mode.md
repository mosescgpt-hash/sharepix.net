# Booth mode: headshots and trade-show photos, delivered to each person

Status: **plan, not built.** Decided so far: email delivery only (no texting
for now), and this plan delivers **full resolution**.

## What it is

A photographer at a corporate event, trade show or headshot booth photographs
a stream of different people. Each person scans in once, gets a QR code, and
shows it to the photographer before their shot. Every photo is sent to the
person it was taken of, full resolution, by email, and nobody sees anyone
else's photos.

This is a different job from SharePix Pro at a wedding. There, the photos go
to one shared gallery as protected previews and the photographer keeps the
originals. Here, each photo has exactly one owner, the deliverable is the
file itself, and there is no shared gallery at all.

## The flow

**1. The host sets up a booth event.** A new plan (see Pricing). Booth events
use everything below instead of the shared gallery. The host invites the
photographer with the existing pairing code.

**2. Attendees sign up once.** They scan a sign at the booth or at check-in
and enter their name and email, then tick a consent box ("Email me the photos
taken of me at this event"). They get a personal QR code on screen, which
they keep on their phone or which can be printed on a badge.

The QR code holds a **random token, never the email address.** Badge codes
get photographed and passed around; a token can be revoked and says nothing on
its own.

**3. The photographer scans, then shoots.** The Pro app gets a scan mode: it
opens the phone camera, reads the attendee's code, and shows "Now shooting:
Alex R." Each scan starts a new person from that moment.

**4. Photos are matched by when they were taken, not when they arrive.** A
photo belongs to whoever was scanned most recently *before the shutter fired*,
read from the photo's own capture time (EXIF `DateTimeOriginal`). Upload order
and wifi delays then cannot misroute anything: shoot Alice, scan Bob, and
Alice's late uploads still go to Alice.

- **Clock offset.** A camera's clock is rarely the phone's. Once per session
  the photographer photographs the scan screen; the app compares that photo's
  capture time with when the screen was shown and stores the offset.
- **No capture time** (some phones strip it, screenshots never had it): fall
  back to upload time and mark the photo "check" in the fix-up screen.

**5. The photographer reviews and fixes.** Approval stays: nothing is sent
until the photographer approves it. The review screen groups photos by person
and lets them:

- move selected photos to another person (missed scan, wrong person);
- send one photo to several people (group shots);
- remove a photo from everyone.

**6. Delivery.** When the photographer approves a person's photos, that person
gets one email with a private link. The link opens a page with only their
photos, each downloadable at full resolution, plus "download all". Approving
more of their photos later sends one follow-up email, batched, not one per
photo.

## Full resolution

The wedding rules (preview only, no download, originals deleted) are reversed
for this plan, deliberately and only for booth events:

- **Originals are kept.** Booth events force "keep originals" on, whatever the
  photographer's profile says, because the original *is* the deliverable.
- **The attendee may download their own originals.** `canDownload` gets a
  booth-event branch: a professional photo is downloadable by the person it
  is assigned to, through their private link, and by nobody else. The
  signing function enforces this, as it does today.
- **Location data is removed** from every delivered file. Check whether the
  pro pipeline strips GPS from originals today; if it does not, it must before
  this ships.
- **Retention.** Originals are kept for a fixed window after the event (30
  days is the proposed default), then deleted, with a reminder email a week
  before. Full-resolution headshots are 10–25 MB each, so this window is the
  storage cost.

## What gets built

| Piece | What it is |
| --- | --- |
| Booth plan | A new tier with a `booth` capability flag, priced separately. |
| `BoothAttendee` table | Event, name, email, consent time, random QR token. Readable only by the host, the event's photographers and admins. |
| Sign-up page | Public page per event: name, email, consent, then the QR code. |
| Scan mode | In the Pro review page: read a QR code, show who is next, record the scan time. |
| Matching | In photo processing: read the capture time, apply the offset, assign the photo to a person. |
| Fix-up screen | Group by person; move, multi-assign, remove. |
| Private gallery | One page per attendee, behind an unguessable link, full-resolution downloads. |
| Delivery email | Sent on approval, batched, with an unsubscribe link, behind `EMAIL_SENDING_ENABLED` like all customer mail. |
| Retention job | Deletes booth originals after the window; sends the reminder. |

## Build order

Each step is one PR and works on its own.

1. **Booth plan and attendee sign-up.** The tier, the table, the sign-up page
   and the QR code. Nothing is matched or sent yet.
2. **Scan mode and matching.** Scanning in the Pro app, capture-time matching
   and the clock offset. Photos land assigned to people.
3. **Fix-up screen.** Move, multi-assign, remove.
4. **Private galleries and full-resolution download.** The attendee page and
   the download rule.
5. **Delivery emails and retention.** Approval sends the email; the cleanup
   job and its reminder.

## Decisions still open

1. **Price.** Per event or per attendee? A headshot booth's value scales with
   people photographed; a flat fee is simpler to sell.
2. **Retention window.** 30 days proposed. Longer costs storage.
3. **Host access.** Should the event host (the company running the booth) see
   every attendee's photos, or only counts? Seeing them is useful for a
   company's own staff headshots, and a privacy question for a public trade
   show.
4. **Attendee without email access on site.** Is sign-up on their phone
   enough, or does the booth need a kiosk/tablet sign-up too?

## Not in this plan

- **Texting.** Skipped for now. Adding it later needs US carrier sender
  registration (a few weeks) and costs about a cent a message.
- **The camera uploader.** Booth mode works with today's browser upload and
  camera-to-phone wifi transfer. A dedicated uploader (`docs/pro-uploader.md`)
  would make a busy booth faster, but this plan does not depend on it.
