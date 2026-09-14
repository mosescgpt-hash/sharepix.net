# Every account SharePix runs on

Where to sign in to do a thing, what each account is actually for, and what
breaks if it lapses. Written because this knowledge otherwise lives in one
person's head and in a browser's saved passwords.

**No credentials here, ever.** This says which door, not which key. Secrets live
in the Amplify console and a password manager; anything pasted into a repository
is in its history permanently.

Related: [deploying.md](deploying.md) for what each environment variable does,
[business-records.md](business-records.md) for the legal filings that carry the
company address.

---

## The four that matter most

If SharePix went down at 2am, these are the four to check, in order.

| | Where | What breaks without it |
| --- | --- | --- |
| **AWS** | console.aws.amazon.com | Everything. The site, the database, the photos, the email. |
| **Cloudflare** | dash.cloudflare.com | Reads fall back to S3 — site works, bandwidth bill multiplies. |
| **Stripe** | dashboard.stripe.com | No one can pay. Events are created and never activate. |
| **GitHub** | github.com/mosescgpt-hash/sharepix.net | No deploys. The running site is unaffected until it needs a change. |

---

## AWS

One account, a lot of services. Almost all of it is defined in `amplify/` and
deployed from code — the console is for looking, for the handful of things CDK
cannot set, and for the environment variables.

| Service | What it holds | When you go there |
| --- | --- | --- |
| **Amplify Hosting** | The app, the build pipeline, the custom domain | Environment variables, secrets, redeploys, build logs. The console you will use most. |
| **Cognito** | Host accounts and the `ADMINS` group | Adding an administrator, or when somebody cannot sign in |
| **S3** | Every uploaded photo and video, as written | Rarely. Deletion goes through a function; nothing grants console-free delete. |
| **DynamoDB** | Events, photos, payments, refunds, everything | Rarely, and read-only unless something has gone badly wrong |
| **AppSync** | The GraphQL API | Query logs when a mutation misbehaves |
| **Lambda** | 37 functions | CloudWatch logs. Do **not** edit environment variables here — the next backend deploy overwrites them from Amplify. |
| **SES** | Outbound email | Sandbox status, verified identities, bounce rate |
| **SQS** | The byte-counting queue | Only if the storage numbers stop moving |
| **Rekognition** | Explicit-content screening | Never directly; it has no console worth visiting |
| **CloudWatch** | Logs and the alarms | Every investigation ends up here — see [alerting.md](alerting.md) |
| **WAF** | API rate limiting, off unless `WAF_ENABLED` | Only when turning it on |
| **Route 53** | Believed to be where `sharepix.net` is registered and resolved | DNS records, and the apex → `www` redirect |

**The trap worth knowing.** Amplify environment variables are read when the
backend is *built*, not when a Lambda runs. Setting one and not redeploying does
nothing, and the console gives no hint. This has caused two false "it's on"
readings; `/global-admin → Scheduled jobs` now shows the live state of both
switches so you can see rather than assume.

## Cloudflare

Same account, two unrelated things.

| | What it is | Notes |
| --- | --- | --- |
| **R2** | Where photo *reads* are served from | S3 is still the write path — see [r2-hybrid.md](r2-hybrid.md). The access key needs read, write **and delete**: reclamation has to remove the R2 copy too, or a "deleted" photo is still reachable. |
| **Web Analytics** | Page-view counts | Free, cookieless, JS beacon. **DNS is not on Cloudflare** and does not need to be. |

Two things about the analytics worth remembering when a number confuses you: it
counts **your** visits too and cannot be told not to — cookieless is exactly why
it needs no consent banner — and the token is `NEXT_PUBLIC_*`, compiled into the
bundle, so changing it requires a redeploy.

`/global-admin → Product health` is the other set of numbers, and it
deliberately excludes you (`lib/analyticsAudience.ts`). The two are meant to
disagree.

## Stripe

Payments for events, add-ons and prints.

- **Webhook** → the `stripe-webhook` function URL, with `STRIPE_WEBHOOK_SECRET`
  matching. If this breaks, customers pay and their event never activates. It is
  the single worst failure in the product.
- **Tax** — `automatic_tax` is on in code and calculates zero everywhere there
  is no registration, which is why it was safe to enable before any existed. See
  [mn-sales-tax-request.md](mn-sales-tax-request.md).
- **Test mode** — prints are still on it. Live mode flips together with Prodigi,
  never alone: [go-live-prints.md](go-live-prints.md).
- The business address on receipts comes from here, not from the repository.

## Prodigi

Print fulfilment. **Sandbox today.** `PRODIGI_ENV` chooses which API the
functions talk to, and `/global-admin → Print check` confirms they answer.

## GitHub

`mosescgpt-hash/sharepix.net`. Amplify builds from `main`, so **merging is
deploying** — there is no separate release step. CI (`verify`) runs the tests,
both typechecks and the stack-cycle check on every PR.

## Google Search Console

search.google.com/search-console. How SharePix appears in search: what is
indexed, what is erroring, what people searched before clicking. Verified by
`public/google308a20708d47773e.html` — **do not delete that file**, Google
re-checks it and removing it un-verifies the property.

## Where the email actually goes

`info@`, `support@` and `seth@sharepix.net` appear on the site and in
`lib/businessInfo.ts`. **SES sends** mail from the domain; it does not receive
it. Whatever hosts those mailboxes — Google Workspace, a forwarder, something
else — is a real dependency of the business and is not recorded anywhere in this
repository.

> **Fill this in.** A customer replying to a refund email, a DMCA notice, a
> Minnesota tax letter and a Stripe dispute all arrive at an address nobody has
> written down the provider for.

## Legal and registration

These are in [business-records.md](business-records.md) with the addresses they
carry and what happens if they lapse. Named here only so this list is complete:

- **U.S. Copyright Office** — DMCA designated agent. Renew by 2 September 2029;
  lapsed means no safe harbour.
- **Minnesota Secretary of State** — the LLC.
- **Minnesota Department of Revenue** — sales tax, if it turns out to apply.

---

## What this costs

Roughly, and only the fixed parts. Storage, bandwidth and Lambda scale with use.

| | |
| --- | --- |
| AWS | Usage-based. DynamoDB, Lambda and SES are near-free at this volume; S3 and CloudFront are the ones that grow. |
| Cloudflare R2 | Storage, with **zero egress** — which is the whole reason reads come from it |
| Cloudflare Web Analytics | Free |
| Stripe | Per transaction |
| Prodigi | Per print |
| GitHub | Free at this size |
| Search Console | Free |
| AWS WAF | **~$7/month if `WAF_ENABLED` is ever set** — the only thing here with a fixed bill, which is why it ships off |

## Things that expire

The failure mode of every one of these is silence.

| What | When | If it lapses |
| --- | --- | --- |
| DMCA agent designation | **2 September 2029** | No safe harbour under 17 U.S.C. § 512(c) |
| Domain registration | Per the registrar | The site stops resolving. Auto-renew and a card that has not expired. |
| TLS certificate | Automatic via Amplify | Nothing to do unless the domain moves |
| Minnesota LLC renewal | Annually | Administrative dissolution |
| R2 and Stripe API keys | Only if rotated | Rotating one means a redeploy, not just a paste |

## Access, honestly

Every account above is on one person. That is normal for a business this size
and it is worth naming rather than discovering: there is no second administrator
on AWS, no shared Stripe login, and no recovery path that does not run through
one email address and one phone.

The cheap mitigations, in the order they pay off:

1. **Recovery codes for AWS and Stripe MFA**, printed and somewhere physical.
2. **A second AWS account with admin**, so a lost phone is an inconvenience.
3. **A password manager the accounts actually live in**, rather than a browser.
