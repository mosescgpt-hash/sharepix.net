# Who can view and download a gallery

Guests can **always upload**. What a host controls is what guests can then *see*
and *take*, and the host has two emergency controls: **Pause sharing** and
**Replace QR code**. Every control is on the event dashboard (the view and
download choices are also on the create-event page), saves the moment it changes,
and can be changed again at any time.

All of it is enforced on the server. The browser only hides things that would
fail anyway.

## The controls

| Control | Field | Effect |
| --- | --- | --- |
| Pause sharing | `sharingPaused` | On: guests see no gallery, no slideshow and no Booth shared gallery, and can download nothing, **at once**. Download share links stop too. Upload still works. Turn it off and everything returns as it was. |
| Replace QR code | `GalleryLink` model, `galleryLinkSet`, `linkRotatedAt` | Makes a new link key. Every older QR code, gallery link, slideshow link and download share link stops working. Printed signs must be reprinted. See below. |
| Guests can view the gallery | `guestViewBlocked` | Off: guests see no gallery, no slideshow and no Booth shared gallery. Upload still works. |
| Guests can download | `guestDownloadsBlocked` | Off: guests get thumbnails only. No originals, no previews, no ZIP, and no guest video (a video has no thumbnail). |
| Who sees which photos | `galleryAudience` | `everyone`, `own` (only their own photos) or `host`. `host` closes the gallery to guests entirely. |

The host and a global admin are never held up by any of these. A download share
link is held up only by Pause sharing and by Replace QR code.

**Existing events keep working.** An event that has never had a QR code replaced
needs no key; with nothing set, view is on, download is on and sharing is not
paused. Nothing that existed before changed.

The dashboard says this in a short note at the top of "What guests can do".

## Pause sharing

A switch the host can flip in a second, for "someone posted something I need to
look at" or "the event is over, for now".

- It is checked on every `listEventPhotos` and `mediaUrls` call, first after the
  host and admin check, so it wins over every other rule, including a download
  share link and a valid QR code.
- The list call fails with `SHARING_PAUSED`. The gallery and the slideshow show
  "Sharing is paused" and carry on checking, so they come back by themselves
  when the host resumes. The download share page says the host has paused sharing.
- Booth's shared gallery link is dropped and the message says so.
- Uploading is untouched. Guests can still add photos and videos; they just
  cannot look at the gallery while it is paused.
- A thumbnail or original a guest already holds a signed URL for keeps working
  until that URL expires (15 minutes at most, see Storage below).

## Replace QR code

Rotates the event's link key. The key is the secret part of the gallery link and
of the QR code.

- The key is 22 characters (16 random bytes, base64url). It lives in
  `GalleryLink`, a model only the `ADMINS` group and the Lambdas can read. The
  guest-readable `Event` row only carries the booleans and timestamp
  `galleryLinkSet` and `linkRotatedAt`, never the key.
- `manageGalleryLink(eventId, 'get' | 'rotate')` is the only way in. It is open
  to signed-in users, and the function itself allows only the event's host or an
  admin. `rotate` writes a new key, sets `galleryLinkSet` and `linkRotatedAt`.
  `get` reads the current key so the host's own screens can build links.
- The key rides in the URL **fragment**, `/event/<id>#k=<key>`, which a browser
  never sends to a server, so it is not in request logs, analytics or a
  `Referer` header. The page keeps it in `sessionStorage` for the tab and sends
  it as `linkKey` to `listEventPhotos` and `mediaUrls`. The server compares it in
  constant time.
- A visitor with no key, or an old one, gets `LINK_REQUIRED`. The page says the
  link was replaced and to ask the host for the new one. Nothing to type, nothing
  to guess.
- **Download share links** (`/share/<id>`) made before the rotation stop working.
  A share is current only if it was made after `linkRotatedAt`. A share with no
  creation time counts as old once a rotation has happened. New shares made after
  the rotation work as normal.
- **Before the first rotation** no key is needed, so existing QR codes and
  links keep working. The first "Replace QR code" turns the key on.
- The dashboard asks for a confirmation first and warns that signs, table tents,
  brochures and anything else printed with the old code must be reprinted. After
  it replaces the code, it shows the new QR code and the upload, gallery and
  slideshow links to copy.
- The sign, table-tent, brochure and NFC pages fetch the current key before they
  draw a QR code, and wait for it, so a sign is never printed without the key
  once one is in force.
- The upload page and its QR code are **not** gated. Guests can still add photos
  from an old QR code, and a join-by-code visit gives upload only. What the old
  code no longer opens is the gallery, the slideshow and downloads.

## What is enforced where

`galleryGateFor` returns the first matching rule:

| Order | Condition | Result |
| --- | --- | --- |
| 1 | Host or admin | `open` |
| 2 | Sharing paused | `paused` |
| 3 | A current download share link | `open` |
| 4 | View off, or audience `host` | `blocked` |
| 5 | A key is in force and the caller's key is missing or wrong | `key` |
| 6 | Otherwise | `open` |

| Path | Rule |
| --- | --- |
| `listEventPhotos` | The gate: `paused` and `key` throw `SHARING_PAUSED` or `LINK_REQUIRED`, `blocked` returns nothing. Then `photoVisibleTo` filters rows (audience, flagged, held, hidden). |
| `mediaUrls` | Same gate and the same allow-list, then signs. Download rules decide thumbnail versus original. Signs R2 `url` and S3 `fallbackUrl`. |
| Guest ZIP and full-size downloads | Go through `mediaUrls`, so they follow pause, link key, view and download. |
| Live slideshow | Reads through `listEventPhotos`, so it follows pause and the link key. The host's own signed-in screen is never held up. |
| Booth shared gallery | `sharedGalleryFor` drops the link when sharing is paused, viewing is off or the gallery is host-only, and says a current link is needed when a key is in force. Person photos stay private. |
| Download share page | A share made before the last rotation, or any share while paused, is refused. |
| `updateEventSettings` | The only way a host changes view, download, audience and pause. It cannot write `galleryLinkSet`, `linkRotatedAt` or the key. |
| `manageGalleryLink` | The only way the key is read or replaced. Host or admin only. |

The gate (`galleryGate.ts`) and the visibility rules (`visibility.ts`) are
copied byte-for-byte into the functions that use them, because function bundles
cannot import from each other. `__tests__/gallery-access.test.ts` fails if a copy
drifts, and also checks that the browser mirror in `lib/galleryAccess.ts` agrees
with the server.

## Storage: guests no longer read `events/*`

The guest and signed-in identity-pool roles used to have S3 `get` on `events/*`,
so anyone who knew a key could read an original with no check. They now have
`write` only (uploading still works). Every read is a short-lived (15 minute)
signed URL from `media-url`, issued after the checks above. Because guests have
no S3 read at all, the S3 fallback is signed server-side too.

Signed URLs are only as strong as the role that signs them, and a URL that has
been shared works until it expires. 15 minutes is the bound, and it is also how
long a guest who already holds a URL can keep using it after a pause or a
replaced QR code.

## Videos

A guest video is held for the host's approval (see `docs/moderation.md`). It
reaches the gallery, slideshow and ZIP only once approved, and only while
downloads are allowed. A video the host uploads is not held.

## Things that behave in a way worth knowing

- **The cover image** is not gated. It is the invitation, not the gallery.
- **Emailed upload links and reminders** carry no key. They open the upload page,
  which is not gated.
- **The review-token moderation links** are not affected by pause or by Replace
  QR code.
- **The booth attendee's own page** (their private link to their photos) is not
  paused and needs no key.
- **A featured event** that is paused, needs a key, or has viewing off, shows no
  photos on the featured and guest book pages (they treat a refused read as empty).
- **A photo just uploaded** is not signed for *other* guests until its row
  exists, a second or two.
- **`listEventPhotos` and `mediaUrls` read the link key's table** on each call
  once an event has a key, an extra DynamoDB read.
- **A leaked link works until the next rotation.** Replace QR code is the remedy.

## Deploying

Deploy the data stack and the functions together with the client. The storage
rule change takes effect with the backend deploy, and an old client that signs
S3 URLs itself will stop showing guest images, so do not run the old client
against the new storage rule. A new client against an old backend would send an
unknown `linkKey` argument, so ship both together. The backend adds the
`GalleryLink` table and three `Event` fields; no secrets or environment
variables are needed by you, and R2 stays optional.
