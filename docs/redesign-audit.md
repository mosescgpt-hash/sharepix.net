# SharePix redesign — Phase 1 audit

Written before any redesign work. Records what exists, what must not be
disturbed, and what the brief actually costs.

**Restore point:** `backup/pre-redesign-2026-09-04` on origin, at `786f87e`.

```
git diff backup/pre-redesign-2026-09-04..main       # what changed since
git checkout backup/pre-redesign-2026-09-04         # look at the old state
```

---

## 1. Architecture summary

Next.js 16 **Pages Router**, React 18, TypeScript, Tailwind 3.4, deployed by
AWS Amplify Hosting. The backend is **Amplify Gen 2** — infrastructure defined
in TypeScript under `amplify/`, synthesised through CDK.

| Area | Files | Lines |
| --- | --- | --- |
| `pages/` | 29 | 7,687 |
| `components/` | 19 | 2,987 |
| `lib/` | — | 5,126 |
| `amplify/` | — | 7,256 |
| `__tests__/` | 39 suites | 4,708 |

563 tests. CI (`.github/workflows/ci.yml`) runs `typecheck:backend`,
`validate:backend` (a real CDK synth) and `jest`.

**Constraint that shapes everything:** Amplify functions bundle separately and
**cannot import from `lib/`**. Shared rules are therefore duplicated by hand
into function directories, with tests asserting the copies have not drifted.
Any redesign that moves logic must respect this.

## 2. Dependencies

Deliberately small: `aws-amplify`, `@aws-amplify/ui-react`, `stripe`, `jszip`,
two QR libraries (`qrcode.react` for simple codes, `qr-code-styling` for the
customisable host one), React and Next. **No component library, no CSS-in-JS,
no animation library.** The redesign should keep it that way — the brief asks
for restraint, and restraint is cheaper to maintain than a design framework.

## 3. Database model

DynamoDB via AppSync. Ten models:

| Model | Purpose | Who can touch it |
| --- | --- | --- |
| **Event** | The core row. Plan, limits, counters, lifecycle dates, feature flags | Owner reads/deletes; **no create, no update** — those go through functions |
| **Photo** | One upload. Keys, uploader, moderation verdict | Host via `eventOwner`; no direct create |
| **GuestBookEntry** | A signed note | Same shape as Photo |
| **DownloadShare** | A share link | Owner |
| **HostProfile** | Display name (Cognito refuses schema changes, so it lives here) | Owner |
| **Payment**, **PrintOrder** | Written by the Stripe webhook | Admins read |
| **CorporateSubscription** | Subscription state | Owner + admins |
| **ModerationReview** | A one-photo review token | Token-addressed |
| **DiscountCode** | Admin-issued codes | Admins |

**The Event row is money.** Plan, photo/video limits, the counters, the
retention dates, and `paid` all live there — which is why the browser has no
`create` or `update` on it. Sixteen custom operations do the writing.

## 4. Authentication

- **Hosts** — Cognito user pool, email login, optional TOTP MFA, an `ADMINS`
  group. Nine pages wrap in `withAuthenticator`.
- **Guests** — never sign in. They use the identity pool's **unauthenticated**
  role. This is the product's central bet and the reason the security model
  looks the way it does.

Do not add `userAttributes` to the auth resource — Cognito refuses to change a
pool's schema after creation and the deploy rolls back. That is why
`HostProfile` exists.

## 5. Storage and upload flow

S3 bucket `sharepixPhotos`, prefix `events/*`, guests and authenticated users
can **read and write but not delete**. Deletion runs through
`deleteEventPhoto`, which checks ownership first.

```
browser picks file
  → uploadData() to S3 under events/<eventId>/photos/
  → onUpload trigger: sanitize-upload validates the real bytes,
    deletes disguised/oversize files, strips EXIF GPS from JPEGs,
    mirrors to Cloudflare R2
  → createEventPhoto: reserves a slot atomically, screens the still
    with Rekognition, writes the Photo row
  → gallery reads via listEventPhotos (scoped) and mediaUrls (batched,
    signs R2 with an S3 fallback)
```

Reads are served from **R2** (free egress) with an **S3 fallback** decided in
the browser, so a missing R2 object degrades rather than breaks.

## 6. Payments

Stripe Checkout. `createCheckoutSession` re-derives price server-side from
`TIER_PRICING` — the client says which plan, never what it costs. The webhook
flips `paid`, `liveSlideshowEnabled`, `guestBookEnabled`, or extends the
window. Prodigi handles print fulfilment.

## 7. Security posture — this is the part to leave alone

The model is unusually careful and the redesign must not erode it:

- **Guests are unauthenticated, so every guest write goes through a Lambda**
  that re-derives entitlement from the Event row. The client names the
  resource; the server names the permissions.
- No model-level `create` on Photo or GuestBookEntry; no guest `list` on
  either (that would enumerate every event on the platform).
- Uploads are validated **by their real bytes** after they land, not by the
  filename or the declared MIME type.
- EXIF GPS is stripped from JPEG originals.
- Rekognition screens stills; screening failure records `skipped` rather than
  blocking the upload, and trips an alarm.
- Media is served through **signed URLs**, never predictable public paths.
- Atomic counters bound uploads and guest book entries.

**Known gaps, unchanged by this audit:** the guest book entry cap is
per-event, not per-person; text screening is a link check, not a content
classifier; there is no per-IP throttle beyond AppSync defaults.

## 8. Technical debt

1. **A design system that is 20% built.** `.sp-card` is used in 25 files but
   `.sp-btn-primary` in only 5 — most pages still hand-roll buttons, inputs
   and spacing. There are no input, modal, badge or empty-state primitives.
2. **No jsdom in the test setup.** Tests are pure-function only; no component
   renders under test. A component-heavy redesign has no safety net unless
   that changes.
3. **Duplicated pricing constants.** `TIER_PRICING` in the Stripe function
   mirrors `lib/pricing.ts` by hand, with a comment as the only link.
4. **`listEventPhotos` and `eventGuestBook` scan and filter** rather than
   using the secondary index. Fine now, not at scale.
5. **Tier strings are load-bearing in five places** — pricing, checkout,
   discount scopes, the guest book gate, and `tier` stamped onto every
   existing event row.

## 9. What the brief costs — the three things to decide first

### 9a. The reference design was not supplied

The brief says "use the supplied SharePix prototype/reference design as the
primary visual inspiration." **Nothing was attached.** Everything below
proceeds from the written direction (cream, charcoal, deep green, tan, serif
display, editorial layout) rather than a comp. If a prototype exists, it
should land before Phase 2, because a design system built to the wrong
reference is expensive to unwind.

### 9b. Photography is the redesign, and there is none

The brief makes photography the visual hero. The site currently contains
**zero photographs** — the demo gallery is generated SVG gradients. Cream
backgrounds and editorial layouts around placeholder rectangles will look
worse than what exists today, not better.

This is an asset problem, not a code problem, and it gates the visual payoff
of Phases 3–5. The build should centralise every image reference behind one
module so production assets drop in without touching layout.

### 9c. The pricing change is a migration, not a constant

| | Today | Brief |
| --- | --- | --- |
| Plans | Starter $19 / Standard $39 / Premium $79 | Free $0 / Event $39 / Plus $69 |
| Subscription | Corporate $149/mo | — |
| Add-ons | Live slideshow $29, guest book $19, window extension | folded into plans |

Changing this touches `lib/pricing.ts`, `TIER_PRICING` in the Stripe function,
discount-code scopes (`event:starter` …), the guest book tier gate, and
**every existing event row**, which carries its tier string stamped at
creation specifically so a later pricing change never retroactively breaks an
event someone paid for. That guarantee is worth keeping.

**A free tier is also a new abuse surface.** Today `paid` gates activation, so
every live event has a card behind it. Free events remove that gate and give
the platform its first unauthenticated-ish path to creating storage. Needs
rate limiting and a tighter retention story before it ships.

Also: **Premium currently advertises "Unlimited photos" in production.** The
brief says not to make unlimited claims before reviewing storage costs — that
claim is already live and should be part of the same review.

## 10. What should not be touched

- `amplify/` — auth, data, storage, and all sixteen functions
- The upload pipeline end to end
- The R2 mirror and signed-URL serving
- Moderation: Rekognition, review tokens, host queues
- Stripe checkout and the webhook
- `lib/` domain logic: pricing maths, lifecycle, validation, guest book rules
- The 563 tests

## 11. What needs redesign

| Area | Files | Note |
| --- | --- | --- |
| Design tokens | `tailwind.config.js`, `styles/globals.css` | New palette, serif display, expanded primitives |
| Shell | `Layout`, `Navbar` | New nav structure, sticky compaction |
| Public site | `index`, `pricing` + **4 new pages** | how-it-works, features, occasions, for-business |
| Guest flow | `event/[eventId]/{index,upload,guestbook}` | Mobile-first, the highest-value surface |
| Host flow | `my-events`, `event/[eventId]/admin` | Dashboard + in-event nav |
| Demo | `demo/*` | Follows the new system |

## 12. Proposed sequence

Each phase is a separate PR, shippable on its own.

| Phase | Work | Risk |
| --- | --- | --- |
| **1** | This audit + backup | none |
| **2** | Design system: tokens, type scale, buttons, inputs, cards, badges, empty states, modals. Plus an image module for centralised photography. No page changes. | low |
| **3** | Homepage rebuilt on the system, then pricing. New public pages after. | low |
| **4** | Guest experience — event page, upload, gallery, guest book. **Mobile first.** | medium — touches the flow that earns the money |
| **5** | Host dashboard and event management | medium |
| **6** | Moments, Missions, guest book audio/video, slideshow | high — new data models |

**Add before Phase 4:** jsdom and React Testing Library. Rebuilding the guest
upload flow with no component tests is the one genuinely risky part of this
plan.

**Moments** (`Account → Event → Moments → Media`) is additive: a `Moment`
model plus an optional `momentId` on Photo. Nothing existing breaks, and
photos without a moment stay valid. Per-moment QR codes reuse the existing
generator. It is Phase 6 because it is the only change that alters the shape
of the data.
