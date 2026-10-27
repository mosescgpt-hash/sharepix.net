# Who can view and download a gallery

Guests can **always upload**. What a host controls is what guests can then *see*
and *take*. Every control is on the event dashboard (and the create-event page),
saves the moment it changes, and can be changed again at any time.

All of it is enforced on the server. The browser only hides things that would
fail anyway.

## The controls

| Control | Field | Effect |
| --- | --- | --- |
| Guests can view the gallery | `guestViewBlocked` | Off: guests see no gallery, no slideshow and no Booth shared gallery. Upload still works. |
| Guests can download | `guestDownloadsBlocked` | Off: guests get thumbnails only. No originals, no previews, no ZIP, and no guest video (a video has no thumbnail). |
| Who sees which photos | `galleryAudience` | `everyone`, `own` (only their own photos) or `host`. `host` closes the gallery to guests entirely. |
| Gallery PIN | `GalleryPin` model, `galleryPinSet`, `galleryPinMode`, `galleryPinAutoDays` | See below. |

The host, a global admin and a download share link (`shareId`) are never held up
by any of these.

## The PIN

A 4 to 6 digit PIN guests enter before they see the gallery, the slideshow or the
Booth shared gallery. It never blocks uploading.

- **When it applies** (`galleryPinMode`): *After the event* (the default, stored
  as no value), *Always on* or *Off*.
- **After the event** means `galleryPinAutoDays` days after the event date, 30 by
  default, 1 to 365. If the event date cannot be read, the creation time is used.
  A PIN that exists but has no usable start date applies at once rather than
  never.
- **It only applies once a PIN exists.** An event with no PIN is never locked,
  so nothing that existed before this feature changed.
- **It is never shown back.** The server keeps a salted scrypt hash and a
  random token key in `GalleryPin`, a model only the `ADMINS` group and the
  Lambdas can read. The guest-readable `Event` row carries only the boolean
  `galleryPinSet`. A host who forgets the PIN sets a new one.
- Setting a new PIN replaces the token key, so every link, QR code and access
  token made with the old PIN stops working at once.

### How a guest gets in

`verifyGalleryPin` checks the PIN and returns a signed access token:
`<expiry>.<HMAC>`, valid 4 hours, bound to the event and to the current token
key. The browser keeps it in `sessionStorage` for the tab and sends it as
`accessToken` to `listEventPhotos` and `mediaUrls`. The slideshow renews it
before it lapses.

### Guessing limits

Fixed 15-minute windows, counted in DynamoDB. A failure counts against the
caller's IP and against the event. **8 failures per IP** or **30 per event** in a
window locks that counter until the window ends, and the answer says how long to
wait. A right PIN refunds its own failure count. The IP limit stops one phone
guessing; the event limit stops a spread-out attack.

Two trade-offs the host should know about:

- A venue behind one shared address shares the per-IP limit.
- A determined attacker can lock the event counter for everyone for one window.
  Hosts and admins are unaffected, and a PIN link or QR code does not touch the
  counters on a right PIN.
- A 4 digit PIN is only 10,000 guesses. The limits make that slow, not
  impossible; the screen suggests six digits.

### PIN links and QR codes

The host can make a link or QR code with the PIN inside at any time, including
after the PIN switched on. Because the PIN is not stored in a readable form, the
host types it again and the server confirms it (`manageGalleryPin` `check`)
before the page builds the link.

The PIN rides in the URL **fragment**, `/event/<id>#pin=123456`, which a browser
never sends to a server, so it is not in request logs, analytics or a `Referer`
header. Scanning skips the prompt. The gallery uses it once and removes it from
the address bar. A forwarded **plain** link still asks for the PIN.

The slideshow screen link keeps the fragment so an unattended screen can reload
and renew itself. Treat that link like the PIN.

## What is enforced where

| Path | Rule |
| --- | --- |
| `listEventPhotos` | `galleryGateFor` gives `open`, `pin` or `blocked`, then `photoVisibleTo` filters rows (audience, flagged, held, hidden). |
| `mediaUrls` | Same gate and the same allow-list, then signs. Download rules decide thumbnail versus original. Signs R2 `url` and S3 `fallbackUrl`. |
| Guest ZIP and full-size downloads | Go through `mediaUrls`, so they follow view, download and PIN. |
| Live slideshow | Off in host-only mode. In PIN mode it needs a token, a `#pin=` link, or the host's own signed-in screen. |
| Booth shared gallery | `sharedGalleryFor` drops the link when viewing is off or the gallery is host-only, and says a PIN is needed when one applies. It never carries the PIN. Person photos stay private. |
| `updateEventSettings` | The only way a host changes the settings above. It cannot write the PIN or `galleryPinSet`. |

The gate (`galleryGate.ts`) and the visibility rules (`visibility.ts`) are
copied byte-for-byte into the functions that use them, because function bundles
cannot import from each other. `__tests__/gallery-pin.test.ts` fails if a copy
drifts, and also checks that the browser mirror in `lib/galleryAccess.ts` agrees
with the server.

## Storage: guests no longer read `events/*`

The guest and signed-in identity-pool roles used to have S3 `get` on `events/*`,
so anyone who knew a key could read an original with no check. They now have
`write` only (uploading still works). Every read is a short-lived (15 minute)
signed URL from `media-url`, issued after the checks above. Because guests have
no S3 read at all, the S3 fallback is signed server-side too.

Signed URLs are only as strong as the role that signs them, and a URL that has
been shared works until it expires. 15 minutes is the bound.

## Videos

A guest video is held for the host's approval (see `docs/moderation.md`). It
reaches the gallery, slideshow and ZIP only once approved, and only while
downloads are allowed.

## Things that behave in a way worth knowing

- **Download share links** (`/share/<id>`) bypass view, audience and PIN. That is
  their purpose.
- **The cover image** is not gated. It is the invitation, not the gallery.
- **A featured event** with a PIN, or with viewing off, shows no photos on the
  featured and guest book pages (they treat a refused read as empty).
- **A photo just uploaded** is not signed for *other* guests until its row
  exists, a second or two.
- **`mediaUrls` queries the event's photo rows** on each call, which is a cost
  the slideshow pays per refresh.

## Deploying

Deploy the data stack and the functions together with the client. The storage
rule change takes effect with the backend deploy, and an old client that signs
S3 URLs itself will stop showing guest images, so do not run the old client
against the new storage rule. No new secrets or environment variables are
needed, and R2 stays optional.
