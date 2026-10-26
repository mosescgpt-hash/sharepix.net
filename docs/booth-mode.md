# Booth mode: headshots and trade-show photos, delivered to each person

Status: **all five steps built** (sign-up, QR codes, scanning, matching, fix-ups, private galleries, delivery emails and the 30-day cleanup). **Included with every event** at no extra cost: the host switches it on under **Extras → Booth mode**, and everything else is on the dashboard's **Booth** tab.
Decided: email only (no texting for now), **full resolution**, **included
with every event** (an option, not a separate plan), originals kept **30 days**, the **host can see** attendees'
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

**1. The host sets up a booth event.** Booth mode is included with every
event: the host taps **Turn on booth mode** under **Extras** (a global admin
can also use **Booth off/on** in the Events list). Booth events use
everything below instead of the shared gallery. The host invites the photographer with the existing pairing
code, and finds the sign-up links on the **Booth** tab (step 1).

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

**5. Review and fix — by the host or the photographer.** Approval stays:
nothing is sent until someone approves it. The host does this on their own
Booth tab (steps 3 to 5); no photographer is
needed. The host can also upload the booth photos there, and they go through
the same QR-code matching as a photographer's. A photographer, if invited,
can still do the same on their review page. The screen groups photos by
person (plus "Check", "Not matched" and "QR code shots") and lets them:

- move selected photos to another person (missed scan, wrong person);
- send one photo to several people (group shots);
- remove a photo from everyone;
- mark a photo as a QR code shot (divider);
- approve one photo, selected photos, or "approve all" for one person.

Who may do this on the server: the event's host or an admin, only on a
booth-mode event (`mayRunOwnBooth`), or a connected photographer on their own
photos. A host upload is stored as the host's own booth photo.

**6. Delivery.** When the host or photographer approves a person's photos, that person
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
| Booth switch | Included with every event; the host turns it on under Extras; the Booth tab then appears (built). |
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
   (Booth mode later became a host option included with every event.)
2. **Scan mode and matching — built.** A Booth mode panel on the Pro review
   page: **Scan next person** opens the phone camera (jsQR, because iPhone
   Safari has no BarcodeDetector); each scan is a `BoothScan` row. Photo
   processing reads the capture time (`lib/captureTime.ts`, no dependency),
   corrects it by the camera clock offset, and assigns the photo to the latest
   scan at or before it. **Sync camera clock** measures the offset from one
   photo taken right after tapping it; until then the phone's time zone is
   assumed, and a guess never replaces a measurement. Photos without a
   believable capture time fall back to upload time and are labelled "check".
   Booth photos are always kept at full resolution and can never be published
   to the event's shared gallery; step 5 removes them after 30 days.
3. **Fix-up screen — built.** "Sort photos by person" on the Pro review page:
   groups for *Check* (matched by upload time), *Not matched*, then each person
   in scan order. Select photos and move them to someone, also send them to
   someone (a group shot, up to 20 people), take someone off, or unassign; a
   person is picked from those this photographer scanned, or by scanning
   their code. Photos now carry a recipient list (`boothAttendeeIds`/`Names`),
   and a fixed photo is marked `manual`. The `assignBoothPhotos` call
   re-checks every photo is the photographer's own booth photo at this event,
   up to 100 at a time.
4. **Private galleries — built.** `/booth/photos/<galleryKey>`: one person's
   photos, only those the photographer **approved**, each downloadable at full
   resolution, plus "Download all" as a zip. The gallery key is separate from
   the QR token (24 random bytes, issued at sign-up; earlier sign-ups get one
   when they sign up again) and will be sent only by email in step 5. Until
   then the host's attendee list has a "Their photos" link per person, for
   testing. The `boothGallery` lookup signs links itself, reading only under
   `pro/`. Booth originals now have their location and camera metadata
   stripped during processing (the same stripper as guest uploads; orientation
   kept), since the sanitizer never covered `pro/`.
5. **Delivery emails and retention — built.** `booth-deliveries` runs hourly
   (at :20). For each booth event it counts each person's approved photos;
   the first time someone has any it emails "Your photos are ready" with
   their gallery link, and when the count grows it sends one "More of your
   photos" email, so a photographer approving a stream of shots sends at
   most one email per person per hour. Each send is claimed with a
   conditional write first (`deliveredCount`), so overlapping runs or retries
   never double-send, and a failed send is released and retried. A week
   before removal, everyone who was sent photos gets one reminder
   (`reminderSentAt`). Thirty days after the end of the event day (UTC), the
   job deletes every booth original under `pro/`, clears `originalObjectKey`,
   and marks the event `boothOriginalsRemovedAt`; previews stay, so the
   gallery still shows what was taken. Every email has a "Stop these emails"
   link (`/booth/photos/<key>?stop=1`, also the `List-Unsubscribe` header),
   which sets `emailsStopped`. The gallery shows the removal date. The host's
   attendee list shows who was emailed and has a **Resend** button (owner or
   admin only, never to someone who stopped emails, at most once in five
   minutes). All of it sends nothing unless `EMAIL_SENDING_ENABLED` is
   `true`; removal runs regardless, because it is cleanup, not mail.

## Offline kiosk (no signal at the venue)

Open `/booth/kiosk/<eventId>` once **with a connection** (the host panel links
it). The service worker (`public/sw.js`, cache `sharepix-kiosk-v1`) keeps the
page and its build files, so it reloads and works with no signal. The badge at
the top shows Online/Offline and "Saved for offline".

Per person: enter an email and/or a cell number (at least one), tick the
matching consent, tap **Get my code**. The page encrypts the details on the
device and shows a QR. The photographer takes **one photo of the QR, filling
most of the frame**, then that person's photos. Tap **Next person** (or wait
90 seconds) and the screen is wiped.

Texting consent wording, shown exactly:
"Text me a link to my photos from [event]. Msg & data rates may apply. Reply STOP to opt out."

### Privacy model

- The host never sees a guest's email or phone. Host screens show a masked
  label only (`j***@gmail.com`, `***-***-4567`); those fields are admin-only in
  the data model and the host's queries never ask for them.
- The kiosk keeps no contact details: no IndexedDB, no cache of typed values.
  localStorage holds only the event name, a count and random person ids.
- Contact details travel only inside the QR, encrypted to the SharePix public
  key. Only the server (the photo processor) holds the private key.

### Code format

`SPB1.<personId>.<base64url(ephemeralKey | iv | ciphertext)>` — about 200
characters for a typical email, ~510 for a 254-character one (fits QR level M).
ECIES: P-256 ECDH → HKDF-SHA256 (salt = ephemeral public key, info
`sharepix-booth-v1`) → AES-128-GCM, with `SPB1.<eventId>.<personId>` as
authenticated data so a code only opens for its own event and person id.
`lib/boothSeal.ts` is copied byte-for-byte to
`amplify/functions/process-pro-photo/boothSeal.ts` and
`amplify/functions/booth-gallery/boothSeal.ts` (a test enforces it). The QR
code wraps it in a link (see "One code").

### Keys

```
node scripts/booth-keygen.mjs /some/private/dir
```

It prints `NEXT_PUBLIC_BOOTH_PUBLIC_KEY=...` and writes the private key to
`booth-private-key.txt` (mode 600; it refuses to overwrite). In Amplify Console →
Hosting → Environment variables set:

| Variable | Value | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_BOOTH_PUBLIC_KEY` | printed public key | no (it ships to browsers) |
| `BOOTH_PRIVATE_KEY` | contents of the file | **yes** — never commit, never in client code |

Then delete the file and redeploy. Without the public key the kiosk shows a
setup notice; without the private key, offline codes are not read. Rotating
keys makes codes made with the old key unreadable, so do it between events.

### How photos are split

The processor reads each pro photo. A booth code that is **large in frame**
(bounding box ≥ 2% of the image and its short side ≥ 12% of the image's short
side, decoded at 1000 px) is a **divider**: it is decrypted, the attendee is
created or matched (same email → same attendee as an online sign-up), and the
photo itself is never sent. Photos are then ordered by the camera's raw EXIF
clock, per photographer: each photo goes to the latest divider at or before it.

Tie-breaks and limits:

- A photo in the same second as a divider goes to the **new** person.
- Two dividers in the same second can't be ordered (EXIF has 1-second
  resolution), so photos in that second may go to either. Leave a second or more between people.
- Photos with no EXIF time, and photos before the first divider, are flagged
  "Needs a person" for the host. A divider with no EXIF time is flagged too.
- A code that is unreadable or from another event still counts as a divider
  for nobody, so the previous person's run ends there.
- Uploads can arrive in any order: a late divider re-matches photos after it.
- In fix-up the host can **Mark as divider** (e.g. a QR shot the scanner
  missed); dividers are listed under "QR code shots — never sent".

**If the QR photo is lost or unreadable, that sign-up is lost** — there is no
other copy of the contact details. The photographer should check the shot.

### Texting

Off unless `BOOTH_SMS_ENABLED=true` and `BOOTH_SMS_ORIGINATION_NUMBER` (a
registered toll-free number) are set on the booth-deliveries function; see
SMS_SETUP notes. A text goes only to someone who ticked the texting consent,
only after the host approves photos, for the first "ready" message and the
reminder (not every extra batch). Before each send, SNS opt-out is checked; a
STOP marks the attendee `smsStopped` and no more texts go. Message:
"SharePix: your photos from <event> are ready. <link> Reply STOP to opt out."

## Decisions

1. **Price:** included with every event, as an option the host turns on.
   No separate plan or fee.
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

## The host's Booth tab

Once booth mode is on, the dashboard shows a **Booth** tab (link straight to it
with `admin?tab=booth` or `admin#booth`). Extras keeps only the switch and an
**Open the Booth tab** button. The tab is five numbered steps, in plain words,
built for a phone:

1. **Sign people up**: the sign-up link and QR code, Open kiosk mode, and Open
   the offline kiosk, with the reminder to take two photos of each person's
   code and wait a second between people.
2. **Who signed up**: everyone, contact details masked, emailed or not, Their
   photos and Resend email.
3. **Upload your photos**: the host's own upload, sorted by the QR code photos.
4. **Check who's in each photo**: tap a group, tap photos, then Move to this
   person, Also send to this person (group photos), Not (name), Unassign
   (nobody) or Mark as QR shot.
5. **Approve and send**: each person shows Waiting for photos, Ready to approve
   or Sent. Approve all for (name), or Approve and send everything, which asks
   first because it emails real people.

Turn booth mode off sits at the bottom of the tab. The photographer's review
page (scanning, camera clock and its own sorter) is unchanged.

## Start & stop codes

The host's Booth tab has a **Start & stop codes** section. Each code is a QR
code signed by the server for this event only (`SPK1.<kind>.<id>.<mac>`, an
HMAC from a key derived from `BOOTH_PRIVATE_KEY`; see
`amplify/functions/*/boothControl.ts`, byte-identical in process-pro-photo,
booth-scan and booth-gallery). A code from another event, or a changed or
made-up one, is treated as unreadable. Code photos are dividers: never in a
gallery, never emailed.

Rules, in the order the photographer photographs (or scans) codes:

- **Event start**: following photos are the event's general photos (no one person).
- **A person's code**: following photos go to that person, and are emailed once approved. If a category is running they are labelled with it.
- **Another person's code**: switches to them.
- **Event start again**: back to the event's general photos.
- **Category start** (a day or session the host created): following photos go to that category.
- **Stop**: following photos are kept but held as "Stopped", never sent, until a start code. A person's code scanned while stopped carries on with that person (no category).
- An unreadable code, or the code of a category that no longer exists: following photos are unsorted until the next good code.
- Photos before any code behave as before (not matched).

Step 4 (sorting) shows Event photos, each category, each person, Stopped and
Not matched groups; the host can move photos between them before approving.
Event and category photos are approved like any other but go to no one;
they are not published to the shared gallery (booth photos never are).

Renaming a category keeps its code, so printed copies still work.

### Guest uploads

A guest can add their own photos from their private photo page (the link they
are emailed, or their own QR code, below) once the event has started, until
uploads close. "Started" means either their code was scanned (live or in a
photographed divider) or the photographer scanned an event or category start
code for this event (`Event.boothStartedAt`, set once by the first one).
Uploads close when:

- the host presses **Close uploads / Stop event** (stays closed until they press Reopen), or
- the stop code is scanned (the next start code reopens them).

Before the start the page says "You can add photos once the event has
started."; after a close it says "Uploads for this event are closed. Thanks
for sharing!". The phone shrinks each photo to 2000 px (which also drops its
location data) before sending. Each upload is one of that person's booth
photos, waiting for the host's approval like any other. Limit: 50 per person
(confirmed).

**Why "started" and not only "scanned":** a guest who signed up but was never
photographed could otherwise never add anything. Opening on the start code
lets everyone at a running event take part, and the host's close/stop still
ends it for everyone.

### One code

A guest's QR code (from online sign-up or the offline kiosk) is one link:

    https://www.sharepix.net/b/<eventId>/t.<token>      online sign-up
    https://www.sharepix.net/b/<eventId>/SPB1.<id>.<…>  offline kiosk (contact still encrypted)

- **The photographer's camera** reads the code inside the link exactly as
  before, so sorting is unchanged (`lib/boothLink.ts`, copied byte-for-byte
  into process-pro-photo, booth-scan and booth-gallery). A link for a
  different event is ignored ("That code is not for this event.").
- **The guest's own camera** opens `/b/…`, which swaps the code for their
  private page (`boothGuestLink` query): their photos, their uploads and a
  button to the event's shared gallery.
- **The kiosk still works offline**: it only builds the link text; nothing is
  fetched until someone opens it.
- **Old codes** (`sharepix-booth:<token>` and bare `SPB1.…`) still sort as
  before.

Opening rules, so a code cannot be forged into someone else's page:

- online: the token is a random secret, so it opens the page straight away;
- offline: anyone can seal an email with the public key, so the page opens
  only once the photographer has photographed *that exact* code (its person id
  is stored on the attendee as `offlinePersonIds`). Until then: "This code is
  not ready yet…".

Whoever holds a guest's code (including the photographer) can open that
guest's page, the same as whoever has their email link.

### Shared gallery

- Approved **event and category** photos (no one person) are published to the
  event's shared gallery, grouped under their category name after any moments
  the host set up (`lib/boothGalleryGroups.ts`).
- A **person's** photos stay private to that person.
- **Stopped, unsorted and divider** photos never go to the gallery, unless the
  host moves them into the event or a category. Moving a published photo to a
  person (or a later divider re-sorting it) takes it out of the gallery again.
- The gallery list also filters booth photos itself, so only published event
  and category ones ever show.
- The rules live in `boothPublish.ts` (booth-scan and decide-pro-photo copies).

The guest's private page shows **See the event's shared gallery**, respecting
the host's gallery setting: everyone → the button; "guests see only their
own" → the button plus a note saying so; host only → no button, a note that
the host keeps it private; taken down → nothing.
