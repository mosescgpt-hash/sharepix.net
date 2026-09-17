# sharepix.net

Event photo sharing. A host creates an event and gets a QR code; guests scan it
and upload from their phones with no app and no account; everyone sees one
gallery. Mobile-first — it has to work one-handed, at a wedding, on venue wifi.

**Stack:** Next.js · React · TypeScript · Tailwind · **AWS Amplify Gen 2**
(Cognito · AppSync · DynamoDB · S3 · Lambda · SES · SQS) · Cloudflare R2 ·
Stripe · Prodigi · Amplify Hosting

The backend is defined in code under `amplify/`. There are no interactive CLI
prompts and no console-only configuration except the secrets and the domain.

---

## Running it

Node 18+. One-time, if you have no AWS profile yet:

```
npm install -g @aws-amplify/cli
amplify configure
```

Only the profile it creates matters — note its name. The IAM user needs
`AdministratorAccess-Amplify`.

Then, in the project:

```
npm install
npx ampx sandbox --profile <yourprofile>
```

`ampx sandbox` reads `amplify/backend.ts`, builds a personal backend in your AWS
account, and writes `amplify_outputs.json`. The first run takes several minutes.
**Leave it running** — it redeploys on change. It is your backend, not
production; `npx ampx sandbox delete` does not touch production.

In a second terminal, `npm run dev`, then http://localhost:3000.

### What runs before a build

`npm run build` runs `prebuild` first, which regenerates two committed things:

- `lib/siteImages.generated.ts`, from the photo folders under `public/site/`
- `public/robots.txt` and `public/sitemap.xml`, from `lib/seo.ts`

Both are committed on purpose, and `npm test` fails if either has drifted from
its source. A generated file nobody can see go stale is how you ship last
month's site map.

## Checks

```
npm run typecheck:backend
npm run validate:backend # synthesises the CDK app and checks for stack cycles
npm test                 # two Jest projects: node (pure) and jsdom (components)
npm run build            # needs an amplify_outputs.json; `{}` is enough
```

CI (`.github/workflows/ci.yml`) runs all four in that order, and all four earn
their place:

- `validate:backend` is not optional ceremony: CloudFormation nested-stack
  cycles do **not** fail synthesis, so `scripts/check-stack-cycles.mjs` is the
  only thing that catches them before a deploy hangs.
- `build` runs last because `prebuild` regenerates committed files, and running
  it first would mask the drift check that catches a stale one. Merging to
  `main` deploys, so without this a broken page has no signal until after it is
  merged.

## Smoke test

1. **Create an event** → sign up with an email → QR code screen.
2. **Upload as a guest**: open `/event/{id}/upload` in a private window. Guest
   uploads are labelled per browser; host uploads carry the host's name.
3. **Gallery** at `/event/{id}`: attribution and a download button per photo.
4. **Dashboard** at `/event/{id}/admin` as the host — see "Share it / Watch it /
   Set it up". Non-owners are turned away by the server, not just the UI.
5. **Find an event without a QR code**: `/join`, then the event code.
6. **Global admin** at `/global-admin` as a member of the Cognito `ADMINS` group.

Add yourself to `ADMINS` with `npm run admin:grant -- <email-prefix>`, or in the
Cognito console. Group membership rides in the token, so sign out and back in.

## Where things are

```
amplify/
  backend.ts           Wiring: every function's env, IAM, queues and triggers
  auth/resource.ts     Cognito — email sign-in for hosts
  data/resource.ts     Models, auth rules, and the custom mutations
  storage/resource.ts  S3 — read/write for everyone, delete for nobody
  waf.ts               API rate limiting, off unless WAF_ENABLED is set
  functions/           37 Lambdas; each has resource.ts (config) + handler.ts
pages/                 Routes. lib/seo.ts says which are public
components/            Shared UI
lib/                   Rules, as pure functions. This is where behaviour lives
__tests__/             Jest. Two projects — see jest.config.js for why
docs/                  The notes below
scripts/               Build-time generators and one-off operator scripts
```

**The light pages do not import `lib/api.ts`.** It is one 3,200-line module and
a bundler splits by module rather than by function, so importing a single symbol
from it delivers all of it — `/` was paying 30 KB gzipped for one call to
`trackEvent`. The few functions the logged-out pages need live in
`lib/trackEvent.ts` and `lib/findEvent.ts`, sharing `lib/dataClient.ts` with
`api.ts` without either importing the other. `__tests__/light-pages.test.ts`
fails if that edge is ever pointed back the other way.

**`lib/` is the important convention.** Rules live there as pure functions so
they can be tested without a browser or an AWS account — who may see a
professional's photo (`professionalMedia.ts`), when a refund is owed
(`refunds.ts`), what a plan includes (`pricing.ts`), which pages search engines
may index (`seo.ts`). Pages and Lambdas call into it; they do not re-decide.

Amplify functions **cannot import from `lib/`** — they are bundled separately.
Where a rule is needed in both places the module is duplicated by hand, with a
test that compares the two copies byte for byte after the opening comment (see
`__tests__/*-function-copy.test.ts`). Ugly, deliberate, and the alternative is
two copies that quietly disagree about money.

## Documentation

| | |
| --- | --- |
| [docs/accounts.md](docs/accounts.md) | Every account SharePix runs on, what each is for, and what lapses |
| [docs/deploying.md](docs/deploying.md) | Deploying, every environment variable, and the manual steps |
| [docs/pro-uploader.md](docs/pro-uploader.md) | The API a DSLR/bridge uploader speaks, for SharePix Pro |
| [docs/decisions.md](docs/decisions.md) | Product decisions, each naming what it supersedes |
| [docs/r2-hybrid.md](docs/r2-hybrid.md) | Why writes go to S3 and reads come from R2 |
| [docs/event-authorization.md](docs/event-authorization.md) | Who may write an event, and why the obvious approach was not safe |
| [docs/moderation.md](docs/moderation.md) | Content screening, and what is deliberately never flagged |
| [docs/media-limits.md](docs/media-limits.md) | Upload size limits and where each is enforced |
| [docs/alerting.md](docs/alerting.md) | What pages an operator when a Lambda starts failing |
| [docs/go-live-prints.md](docs/go-live-prints.md) | Prints are live: how they are priced, and how a Prodigi price change is caught |
| [docs/research-survey.md](docs/research-survey.md) | Why the post-event survey asks what it asks |
| [docs/design-system.md](docs/design-system.md) | Palette, type, and the rules the pages follow |
| [docs/business-records.md](docs/business-records.md) | Public records that name SharePix LLC and have to agree |
| [docs/mn-sales-tax-request.md](docs/mn-sales-tax-request.md) | The request asking Minnesota whether SharePix is taxable at all, and what each answer means |
| [docs/mn-print-tax-request.md](docs/mn-print-tax-request.md) | The follow-up asking about physical prints, which the service answer does not cover. `npm run letter:docx` renders the draft as a Word document |
| [docs/moments-verification.md](docs/moments-verification.md) | The walkthrough that proved Moments really writes to DynamoDB |
| [docs/redesign-audit.md](docs/redesign-audit.md) | What existed before the redesign, and what it must not disturb |

## How authorization works

- **Hosts** sign in with email. Events are `owner`-protected.
- **Guests** never sign in. The identity pool's unauthenticated role lets them
  read events, create photos, and write to `events/*` in S3.
- **Nobody gets S3 delete.** `storage/resource.ts` grants `read` and `write` and
  stops there; deletion runs through the `deleteEventPhoto` function, which
  checks ownership first. A blanket delete grant would let any signed-in user
  remove another event's files.
- **Photos** are stamped with `eventOwner` at upload, and
  `ownerDefinedIn('eventOwner')` lets the host moderate every photo in their
  event — server-side, not in the UI.
- **Limits are reservations, not checks.** `create-event-photo` reserves a slot
  with a conditional DynamoDB update, so concurrent uploads cannot both take the
  last one. Same for the one free event per account.
- **Professional originals are never signed.** A photographer's full-resolution
  file has no access rule that reaches it and no code path that mints a URL for
  it; guests are served a reduced-resolution preview. See `lib/professionalMedia.ts`.
- **Event codes** are three words from a 7,772-word list (~4.7 × 10¹¹
  combinations). `amplify/waf.ts` adds rate limiting in front of the lookup, off
  by default because it costs about $7 a month whether or not anyone attacks it.

## What is not finished

Two kinds of thing, kept apart on purpose. The first kind this file can be
right about; the second it cannot, and pretending otherwise is how a list like
this goes stale within a day.

### In the code

`__tests__/readme.test.ts` fails if one of these is fixed without this list
being updated.

- **No real print order has ever been placed.** `PRODIGI_ENV` is `live` and the
  Stripe key is a live one, so a print checkout charges a real card and submits
  a real order. What has never run is the last hop: Prodigi creating the order
  and fetching the signed asset URL. Everything up to it is proven —
  see [docs/go-live-prints.md](docs/go-live-prints.md).
- **No face recognition, and none planned.** Rekognition is used for explicit
  content only.

### Switches that ship off

These are environment variables set in the Amplify console, so **the live value
is not in this repository and nothing here can check it.** What follows is what
an unconfigured deployment does, not a claim about production — look in
**Amplify → Hosting → Environment variables** for what is actually set, and see
[docs/deploying.md](docs/deploying.md) for what each one costs and how to turn
it on safely.

| Variable | Unset behaviour |
| --- | --- |
| `EMAIL_SENDING_ENABLED` | Every send is a dry run that logs what it would have sent. |
| `STORAGE_RECLAIM_ENABLED` | The reclaim job decides, logs every key it would remove, and deletes nothing. Expired events keep their bytes. |
| `WAF_ENABLED` | No rate limiting in front of the API. The word codes are what makes guessing infeasible; the throttle is the second lock. |

This section used to assert the production state of all three, plus that the
apex did not redirect to `www`. Within a day of writing it two of those four
were wrong, because they describe a console somebody clicked in rather than a
file anybody can read. A guarded list that quietly stops being true is worse
than no list, so the claims and the configuration are now separated: the part
above is checkable and checked, and this part says only what the default is.

## Troubleshooting

- **"AWS is not configured" banner** → `npx ampx sandbox` has not written
  `amplify_outputs.json` yet, or is not running from the project root.
- **`ampx sandbox` credential errors** → pass `--profile`; the IAM user needs
  `AdministratorAccess-Amplify`.
- **A deploy hangs with no error** → almost always a nested-stack cycle. Run
  `npm run validate:backend`, which names the loop.
- **A function throws `Could not load the "sharp" module`** → esbuild reports
  success bundling `sharp` and the artifact fails at runtime. Image work uses
  Jimp for this reason. Jimp cannot decode WebP; that is the trade.
- **Guest upload Unauthorized** → the rules live in `amplify/data/resource.ts`
  and `amplify/storage/resource.ts`; make sure the sandbox is this project's.
- **`npm ci` fails in CI with "Missing: <pkg> from lock file"** → something ran
  `npm install` behind a proxy that prunes the lockfile. Fix with
  `npm install --package-lock-only`, then verify with `npm ci --dry-run`.
