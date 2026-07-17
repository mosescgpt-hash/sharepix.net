# sharepix.net

Event photo sharing: a host creates an event, gets a QR code, guests scan it and upload photos, and everyone views the shared gallery. Mobile-first — works one-handed on iPhone and Android, and the same in any desktop browser.

**Stack:** Next.js · React · TypeScript · Tailwind CSS · **AWS Amplify Gen 2** · Cognito (host auth via email) · S3 (photos) · AppSync + DynamoDB (data) · Amplify Hosting

The backend is defined in code under `amplify/` (auth, data, storage) — no interactive CLI prompts needed.

---

## Setup (Windows-friendly)

**One-time machine setup:**
1. Install Node.js 18+ from nodejs.org
2. Configure an AWS profile if you haven't:
   ```
   npm install -g @aws-amplify/cli
   amplify configure
   ```
   (Only the profile it creates matters — note its name, e.g. `seth`. The IAM user needs the `AdministratorAccess-Amplify` policy.)

**Project setup — two commands:**

```
npm install
npx ampx sandbox --profile seth
```

`ampx sandbox` reads `amplify/backend.ts`, builds your personal cloud backend (Cognito + AppSync + DynamoDB + S3) in your AWS account, and writes `amplify_outputs.json` for the app. First run takes several minutes. **Leave it running** — it watches for backend changes. It's your dev backend; production gets its own copy at deploy time.

**In a second terminal:**

```
npm run dev
```

Open http://localhost:3000.

### Pilot access codes

Global administrators create and manage complimentary pilot codes at
`/global-admin`. Each code can be assigned to one person, limited to a specific
number of uses, expired immediately, or given a future expiration date. Pilot codes
only unlock the Standard plan.

The dashboard is secured by the Cognito `ADMINS` group. Add an administrator to that
group in the Amazon Cognito console after deploying a new backend, or run
`npm run admin:grant -- email-prefix` with the appropriate AWS profile configured.
Group membership is included in the user's token, so sign out and back in after it changes.

## Smoke test

1. **Create an event** → sign up with an email (Cognito sends a verification code) → you get the QR code screen.
2. **Upload as a guest**: open `/event/{id}/upload` in an incognito window. Photos from guests tag as "Anonymous"; host uploads tag with the email name (e.g. `seth`).
3. **Gallery** at `/event/{id}`: "Uploaded by" + download button per photo.
4. **Admin** at `/event/{id}/admin` as the host: hide/approve and delete photos. Non-owners are turned away.
5. **Global admin** at `/global-admin` as an `ADMINS` user: monitor all events and manage pilot codes.

## Tests

```
npm test
```

## Deploy to production + sharepix.net

Gen 2 production deploys through Amplify Hosting from a Git repo:

1. Install Git (gitforwindows.org), then push this folder to a new GitHub repository.
2. AWS console → **Amplify** → **Create new app** → connect the GitHub repo and branch.
3. Amplify detects `amplify.yml`, builds the backend (`ampx pipeline-deploy`) and the frontend, and deploys both. Every `git push` redeploys.
4. **Domain management** → Add domain → `sharepix.net` → follow the DNS steps at your registrar. SSL is automatic.

## Project structure

```
amplify/
  backend.ts               Backend entry point
  auth/resource.ts         Cognito: email sign-in for hosts
  data/resource.ts         Event + Photo models with auth rules
  storage/resource.ts      S3: guests upload/read, hosts delete
amplify.yml                Amplify Hosting build spec (backend + frontend)
pages/                     Homepage, pricing, create-event, event gallery/upload/admin
components/                Logo, EventQRCode, UploadForm, PhotoGrid, PhotoCard,
                           AdminPhotoGrid, PricingCards, Layout, Navbar
lib/                       api.ts (all AWS calls), pricing.ts, validation.ts, types.ts
__tests__/                 Jest tests
```

## How authorization works

- **Hosts** sign in with email (user pool). Events are `owner`-protected: only the creator can update/delete.
- **Guests** never sign in; the identity pool's unauthenticated role lets them read events and create/read photos, and upload to `events/*` in S3.
- **Moderation**: every photo is stamped with `eventOwner` (the host's owner id) at upload, and the `ownerDefinedIn('eventOwner')` rule lets the host update/delete any photo in their event — enforced server-side, not just in the UI.

## Design notes

- Brand palette from the SharePix logo: navy `#123851`, mint `#7AD8C0`, green `#099361`, white cards on light gray, large tap targets. Tagline: Capture. Connect. Celebrate.
- Logo (components/Logo.tsx + public/favicon.svg): a camera whose film window is a QR code, with the green play lens.
- Guest upload shows the consent line about photos being visible to other guests.

## Known gaps (deliberate for an MVP)

- **Payments not wired up** — event creation is free while testing. Next: Stripe Checkout + a backend function that verifies payment before creating the Event.
- **Photo limits not enforced server-side** — add a function/custom mutation before launch.
- **S3 delete scope**: any signed-in user can delete S3 objects under `events/*` (the database rules are properly scoped; tighten storage with a custom authorizer or move deletes behind a function before launch).

## Troubleshooting

- **Yellow "AWS is not configured" banner** → `npx ampx sandbox` hasn't generated `amplify_outputs.json` yet, or it's not running from the project root.
- **`ampx sandbox` credential errors** → pass `--profile yourname`; the IAM user needs `AdministratorAccess-Amplify`.
- **Guest upload Unauthorized** → make sure you're running the sandbox from this project (rules live in `amplify/data/resource.ts` and `amplify/storage/resource.ts`).
- **Sandbox vs production** → the sandbox is your personal dev backend; deleting it (`npx ampx sandbox delete`) doesn't touch production.
