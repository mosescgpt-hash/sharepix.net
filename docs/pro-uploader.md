# The SharePix Pro uploader API

What a program has to do to get a photograph from a camera into an event
gallery. Written for any DSLR/bridge uploader — a tethered laptop watching a folder,
or a box beside the photographer — so the contract is written down before
something is built against a guess. The first one, the browser watch folder, is
described at the end.

Everything here is the public GraphQL API. There is no separate uploader
endpoint and no API key: an uploader is a photographer's client, signs in as
that photographer, and can do exactly what the web dashboard can do.

## The shape of it

Three calls per photograph, and none of them carries the image through the API:

```
requestProUploadSlot  →  { uploadId, uploadUrl, expiresInSeconds }
PUT uploadUrl            (the bytes, straight to S3)
processProPhoto       →  { uploadId, publishStatus, message }
```

The middle step is a plain HTTPS PUT to a presigned S3 URL. A 40 MB raw file
never passes through AppSync or a Lambda, which is what keeps this affordable
and what keeps a slow venue connection from timing out a GraphQL request.

## Before any of that: pairing

A photographer is connected to an event by a code the **host** generates, on the
event dashboard under "Set it up → SharePix Pro". It is shown once, works once,
and expires in 30 minutes.

```graphql
mutation Join($code: String!) {
  connectPhotographer(action: "accept", code: $code) {
    ok
    message
  }
}
```

`action` is one of `invite` (host only — returns the code), `accept`
(photographer, with `code`), or `remove` (host, with `photographerId`).

A photographer cannot invite themselves and a host cannot accept on a
photographer's behalf. Both rules are in `lib/photographerAccess.ts` and are
re-checked in the function; the dashboard only decides which buttons to draw.

The connection survives until the host removes it, so an uploader pairs once per
event and not once per session.

## 1. Ask for a slot

```graphql
mutation Slot($eventId: ID!, $contentType: String) {
  requestProUploadSlot(eventId: $eventId, contentType: $contentType) {
    uploadId
    uploadUrl
    expiresInSeconds
  }
}
```

`contentType` is the MIME type you are about to send. It is baked into the
signature, so sending something else gets a signature mismatch from S3 rather
than an unexpected object.

**You do not choose the key.** It is built server-side from the event id and a
fresh UUID. A presigned URL is a capability — whatever it is signed for is what
the holder can write — so letting a caller name the key would let one aim an
upload at another event's prefix, at the previews folder, or at a key that
already holds somebody's photograph.

The URL is good for **15 minutes**. That is sized to push a large file over
venue wifi, not to be held. If a queued upload has been waiting longer than
that, ask for a new slot; do not retry a stale URL.

A photographer who is not connected to that event, or whose invitation is still
unaccepted, gets `That event could not be found.` — the same message as an event
id that does not exist. The ambiguity is deliberate: a more specific error would
let somebody map which events exist and who is shooting them.

## 2. Send the bytes

```
PUT <uploadUrl>
Content-Type: <the same contentType>

<the file>
```

Nothing else. No auth header — the signature in the URL is the authorization,
and adding one will break it.

## 3. Tell SharePix it landed

```graphql
mutation Process($eventId: ID!, $uploadId: String!) {
  processProPhoto(eventId: $eventId, uploadId: $uploadId) {
    uploadId
    publishStatus
    message
  }
}
```

This is where the photograph becomes a gallery tile. The function reads the
original, makes a reduced-resolution preview and a thumbnail with Jimp, applies
the photographer's watermark if they have set one, writes the `Photo` row, and
then — unless the photographer has ticked "keep my originals" — **deletes the
original**.

That last part is the deliberate bit, and an uploader should be built knowing
it: by default SharePix does not keep a photographer's full-resolution file. It
is there to make the preview and then it is gone. The originals are the
photographer's business and their print sales; storing them would mean charging
for storage nobody asked for.

**It is idempotent on `uploadId`.** Calling it twice does not produce two tiles.
An uploader with a retry queue can call it again after a network failure without
checking first, which is the point.

If the derivatives could not be written, the original is kept rather than
deleted — see `discardDecision()` in `lib/proProcessing.ts`. A failure never
destroys the only copy.

### What `publishStatus` comes back as

| | |
| --- | --- |
| `received` | Landed and processed. Not visible to guests yet. |
| `approved` | The photographer approved it. Still not visible to guests. |
| `published` | Visible in the event gallery. |
| `rejected` | The photographer turned it down. |

**Nothing auto-publishes.** A new photograph is `received`, and only a
photographer's own decision moves it on. An uploader must not try to publish on
their behalf.

Guests are served a photograph only at `published` (`mayServeToGuest()`), and
are never offered a download of one at all (`canDownload()`). Both live in
`lib/professionalMedia.ts` and are enforced when the URL is signed, not in the
gallery UI.

## 4. Decisions, if the uploader offers them

```graphql
mutation Decide($uploadId: String!, $decision: String!) {
  decideProPhoto(uploadId: $uploadId, decision: $decision) {
    uploadId
    publishStatus
    message
  }
}
```

`decision` is `approve`, `reject`, `publish`, or `unpublish`. The legal
transitions are in `lib/professionalMedia.ts` and are re-checked server-side —
an uploader that offers a "publish everything" button will find the server
refusing the ones that are not eligible, rather than the button being wrong.

Go Live / Pause for a whole event is separate:

```graphql
mutation Publishing($eventId: ID!, $livePublishing: Boolean) {
  setProPublishing(eventId: $eventId, livePublishing: $livePublishing) {
    publishStatus
    message
  }
}
```

## Building against this

- **Queue, do not block.** Venue wifi drops. Hold the file, get a slot when
  there is a connection, and let step 3's idempotency cover the retries.
- **Ask for the slot late.** The URL expires in 15 minutes; getting one at the
  front of a long queue wastes it.
- **Do not parallelise hard.** One photograph at a time up a venue's uplink
  finishes sooner than eight at once, and the photographer is watching the
  gallery fill.
- **Send what the camera produced.** Sanitisation, EXIF/GPS stripping, and
  resizing all happen server-side. An uploader that pre-resizes is throwing away
  the resolution the preview is made from.
- **Expect `That event could not be found.`** for every authorization failure.
  Do not try to distinguish them; there is nothing to distinguish.

## The one that exists: the watch folder

The first uploader built against this is not a separate program. It is the
**Watch a folder** panel on the pro review page
(`components/WatchFolderUploader.tsx`, rules in `lib/watchFolder.ts`). The
photographer opens their event's review page in Chrome or Edge on the laptop,
picks the folder their tether software, camera transfer app or Lightroom export
writes JPEGs into, and leaves the tab open.

It follows the advice above:

- **Same three calls.** It sends through the page's `sendOne`, the function
  "Add photos" uses, so there is one upload path and not two.
- **Signed in as the photographer** by being the dashboard — no API key, no
  stored password, nothing to install, no new backend.
- **One at a time, oldest first,** and a file is only sent once its size has held
  still across two listings (every 3 seconds), so a JPEG still being written is
  never sent half-finished.
- **JPEG and PNG only.** RAW files, macOS `._` files and anything over the
  processor's size limit are left alone.
- **Only new files by default.** Whatever is in the folder at Start is ignored
  unless "Also send photos already in it" is ticked.
- **Remembers what it sent,** per event, in that browser's localStorage, so
  reloading the page and choosing the folder again does not resend. Only sent
  files are remembered.
- **Retries** a failed file on the next scan, up to 3 tries, and stops watching
  outright on `That event could not be found.`
- **Keeps the screen awake** with a wake lock while watching.

Limits, stated plainly:

- Chrome and Edge only (the File System Access API). Safari and Firefox see a
  note saying so.
- The tab has to stay open. When it is in the background or the window is
  hidden, Chrome throttles timers, so a scan can be up to about a minute apart.
- Top level of the folder only; subfolders are not walked.

Direct camera-to-cloud upload (FTP/SFTP from the camera) is the next step if
photographers ask for it; it needs new infrastructure and a fixed monthly cost.

## What this is not

Live video. SharePix Pro moves stills, quickly — a photograph reaching the
gallery within a minute or two of the shutter. There is no DSLR video streaming
path and none is planned; that is a different product with a different cost
structure.
