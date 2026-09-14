# Deploying SharePix

Everything that has to be true for production to work, and the handful of things
that cannot be set from this repository.

## The shape of a deploy

Amplify Hosting builds from a Git branch. `amplify.yml` runs
`ampx pipeline-deploy` for the backend and `npm run build` for the frontend, so
every push to the connected branch redeploys both. There is no separate backend
deploy step and no manual CloudFormation.

First time:

1. Push the repository to GitHub.
2. AWS console → **Amplify** → **Create new app** → connect the repo and branch.
3. Set the secrets and environment variables below **before** the first build.
   A build without them succeeds and produces a site that cannot take payment.
4. **Hosting → Custom domains** → add `sharepix.net`.

## Secrets

Three, and they are Amplify *secrets* rather than environment variables —
`secret()` in the function's `resource.ts`, set with
`npx ampx sandbox secret set NAME` for a sandbox, or under **Hosting →
Secrets** for a branch.

| Secret | Used by |
| --- | --- |
| `STRIPE_SECRET_KEY` | `stripe-checkout`, `print-checkout` |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` |
| `PRODIGI_API_KEY` | `print-checkout`, `print-fulfill` |

They are secrets and not environment variables because an environment variable
is readable from the Amplify console by anyone with console access, and these
three move money.

## Environment variables

Set on the Amplify app (**Hosting → Environment variables**). Everything ending
in `_TABLE_NAME` or `_BUCKET_NAME` is wired by `amplify/backend.ts` from the
resources it creates — do not set those by hand.

### Required for a working production site

| Variable | What happens without it |
| --- | --- |
| `APP_URL` | Defaults to `https://www.sharepix.net`. Set it for any other branch, or emails and QR codes will point at production. |
| `R2_ACCOUNT_ENDPOINT` | |
| `R2_BUCKET` | Reads fall back to S3. Everything works and egress costs a great deal more — see [r2-hybrid.md](r2-hybrid.md). |
| `R2_ACCESS_KEY_ID` | |
| `R2_SECRET_ACCESS_KEY` | |
| `ALERT_FROM_ADDRESS` | A verified SES identity. Without it no transactional email can be sent at all. |
| `ALERT_REPLY_TO` | Replies go to the from-address. |
| `ALERT_EMAIL` | Nobody is paged when a Lambda starts failing — see [alerting.md](alerting.md). |
| `REPORT_TO_ADDRESS` | The monthly report is generated and sent nowhere. |

### Switches, all off by default

These ship unset on purpose. Each one does something you want to have decided
deliberately rather than inherited.

| Variable | Set to | Effect |
| --- | --- | --- |
| `EMAIL_SENDING_ENABLED` | `true` | Actually sends. Unset, every send is a dry run that logs what it would have sent and returns a count. **Watch the first production run.** |
| `STORAGE_RECLAIM_ENABLED` | `true` | Lets the reclaim job delete expired events' bytes. Unset, it decides, logs every key it would remove, and deletes nothing. The only job that destroys data, and its own switch for that reason. |
| `WAF_ENABLED` | anything | Rate limiting in front of the API. About $7/month before traffic, whether or not anyone attacks — see `amplify/waf.ts` for when it is worth paying. |

### Tuning, with sensible defaults

| Variable | Default |
| --- | --- |
| `S3_COPY_RETENTION_DAYS` | `90` |
| `RATING_DELAY_DAYS` | `2` |
| `RESEARCH_SURVEY_DELAY_DAYS` | `7` |
| `RESEARCH_SURVEY_ID` | `post-event-v1` |
| `RESEARCH_SURVEY_URL` | unset — no survey invite is sent |
| `RESEARCH_FULFILMENT_DAYS` | unset |

## The domain

`www.sharepix.net` is the canonical host. Every link the product mints says so:
`APP_URL` in the backend, the canonical tags from `lib/seo.ts`, the QR codes
(which read `window.location.origin`), the printed table tents and brochures.

In **Hosting → Custom domains**, tick **"Setup redirect from
https://sharepix.net to https://www.sharepix.net"**.

Do *not* use "Include root" to serve both. QR codes are printed from whichever
host the dashboard was open on, so serving both hostnames means printed codes
split across two origins with no way to tell from the paper which one a given
card carries. One host, one redirect.

Once the redirect is live, submit `https://www.sharepix.net/sitemap.xml` in
Google Search Console.

## Steps that are not in this repository

Nothing here can set these, and each one is silently wrong until it is done.

**Stripe**
- Webhook endpoint pointing at the `stripe-webhook` function URL, with
  `STRIPE_WEBHOOK_SECRET` matching.
- Tax registrations for the states SharePix has nexus in — see `lib/taxNexus.ts`
  for what the code assumes.
- Live mode, when prints go live. Both halves together — see
  [go-live-prints.md](go-live-prints.md).

**SES**
- Verify `ALERT_FROM_ADDRESS` as an identity.
- Move out of the sandbox, or SES will only deliver to verified addresses and
  every guest-facing email silently fails.
- DKIM and a DMARC record, or reminders land in spam.

**Cognito**
- Add the first administrator to the `ADMINS` group:
  `npm run admin:grant -- <email-prefix>`, or in the console. Group membership
  rides in the token, so sign out and back in after.

**Cloudflare**
- The R2 bucket and an access key with read/write/delete.
- An analytics token, if the funnel numbers are wanted.

**In the app, once**
- `/global-admin → Report recipient` — where the monthly report goes.

## After a deploy

1. `/` loads and the homepage QR modal opens.
2. Create an event end to end, including payment in Stripe test mode.
3. Upload as a guest from a phone on mobile data, not office wifi.
4. `/event/{id}/admin` → the QR code renders and the table tent prints.
5. `/global-admin → Alert email check` sends a test alert.
6. `/global-admin → Print check` confirms Prodigi answers.
7. `/global-admin → Scheduled jobs` → run the daily job by hand and read the
   count of what it *would* have sent before turning `EMAIL_SENDING_ENABLED` on.

## When a deploy hangs

Almost always a CloudFormation nested-stack cycle. Synthesis does **not** catch
these — the app synthesises cleanly and the deploy sits there.

```
npm run validate:backend
```

`scripts/check-stack-cycles.mjs` names the loop. The usual cause is a function
in the wrong `resourceGroupName`: a function that is an AppSync handler *and*
reads a data table belongs in the `data` group, because bucket grants flow that
way and table grants do not flow back.
