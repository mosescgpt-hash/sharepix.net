# Booth mode: headshots and trade-show photos, delivered to each person

Status: **step 1 built** (sign-up and QR codes); steps 2–5 not yet.
Decided: email only (no texting for now), **full resolution**, a **flat fee
per event**, originals kept **30 days**, the **host can see** attendees'
photos (disclosed at sign-up), and a **kiosk sign-up** for a tablet or
computer at the booth.

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

**1. The host sets up a booth event.** Until the plan is priced and sold,
a global admin switches booth mode on for the event (the **Booth off/on**
button in the Events list). Booth events use everything below instead of the
shared gallery. The host invites the photographer with the existing pairing
code, and finds the sign-up links under **Extras → Booth mode**.

**2. Attendees sign up once,** at `/booth/<eventId>`: on their own phone from
a sign or badge, or at the booth on a tablet or computer running kiosk mode
(`?kiosk=1`). They enter their name and email and tick the consent box
("Email me the photos taken of me at this event. The event host can also see
them."). They get a personal QR code on screen. Their phone remembers it; the
kiosk remembers nothing, shows the code large for the photographer, and
clears itself after 90 seconds or "Done — next person". Signing up again with
the same email returns the same code.

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
| Booth plan | A flat-fee tier with a `booth` capability flag, wired to checkout once priced. Until then an admin switch on the event (built). |
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

1. **Attendee sign-up — built.** The admin switch, the `BoothAttendee` table,
   the `boothSignUp` function (one row per email per event, 10,000 sign-ups per
   event at most), the sign-up and kiosk page, and the host's attendee list.
   The paid plan itself waits for the price.
2. **Scan mode and matching.** Scanning in the Pro app, capture-time matching
   and the clock offset. Photos land assigned to people.
3. **Fix-up screen.** Move, multi-assign, remove.
4. **Private galleries and full-resolution download.** The attendee page and
   the download rule.
5. **Delivery emails and retention.** Approval sends the email; the cleanup
   job and its reminder.

## Decisions

1. **Price:** a flat fee per event. The amount is still to be set; until
   then booth mode is switched on by an admin, so nothing is sold at a
   placeholder price.
2. **Retention:** 30 days after the event.
3. **Host access:** the host sees every attendee and their photos. Attendees
   are told so in the consent line at sign-up.
4. **Kiosk sign-up:** yes, on any tablet or computer at the booth.

## Not in this plan

- **Texting.** Skipped for now. Adding it later needs US carrier sender
  registration (a few weeks) and costs about a cent a message.
- **The camera uploader.** Booth mode works with today's browser upload and
  camera-to-phone wifi transfer. A dedicated uploader (`docs/pro-uploader.md`)
  would make a busy booth faster, but this plan does not depend on it.
