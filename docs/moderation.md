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

## Cost

Roughly **$1 per 1,000 images** (confirm current Rekognition pricing). A
500-photo wedding is about **$0.50**.
