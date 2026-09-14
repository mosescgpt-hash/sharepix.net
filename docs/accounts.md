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
| **CloudWatch** | Logs and the alarms | Every investigation ends up here — see [alerting.md](alerting.md). Logs expire after 90 days, or a year for the five functions whose logs are a record rather than a diagnostic. |
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
- **Live mode, everywhere.** `STRIPE_SECRET_KEY` is an `sk_live_…` key, so every
  checkout — events, add-ons and prints alike — charges a real card. There is no
  longer a test-mode half: [go-live-prints.md](go-live-prints.md).
- The business address on receipts comes from here, not from the repository.

## Prodigi

Print fulfilment, and **live** — `PRODIGI_ENV` is `'live'`, so a print checkout
charges a real card and submits a real order. `/global-admin → Print check`
quotes all five sizes against the live catalogue for free, and is also the only
thing that will tell you Prodigi's prices have moved.

They had, badly enough that small orders lost money on every sale. The catalog
now matches a live quote and carries an 8% buffer, and `daily-tasks` re-checks
it every Monday — a mismatch raises `sharepix-print-price-drift` rather than
waiting to be noticed. See [go-live-prints.md](go-live-prints.md).

## GitHub

`mosescgpt-hash/sharepix.net`. Amplify builds from `main`, so **merging is
deploying** — there is no separate release step. CI (`verify`) runs the tests,
both typechecks and the stack-cycle check on every PR.

## Google Search Console

search.google.com/search-console. How SharePix appears in search: what is
indexed, what is erroring, what people searched before clicking. Verified by
`public/google308a20708d47773e.html` — **do not delete that file**, Google
re-checks it and removing it un-verifies the property.

## Outlook — where the email actually goes

`info@`, `support@` and `seth@sharepix.net` appear on the site and in
`lib/businessInfo.ts`. **SES sends** mail from the domain; it does not receive
it. **The mailboxes are on Outlook** — sign in at outlook.com, or through the
Microsoft 365 admin centre if a mailbox needs adding or a password resetting.

This is a bigger dependency than its size suggests. A customer replying to a
refund email, a DMCA notice, a Minnesota tax letter and a Stripe dispute all
land here — and so does every account-recovery message for the accounts above,
which is why losing this mailbox is worse than losing any single one of them.

Two things follow from the split between sending and receiving:

- **Outbound problems are an SES problem, inbound problems are an Outlook
  problem.** A host who never got their event email is SES and CloudWatch; a
  reply that never reached you is Outlook. They share a domain and nothing else.
- **The MX records point at Outlook**, wherever DNS for `sharepix.net` is
  currently served from. Moving nameservers without carrying the MX records
  across stops mail arriving, silently and with nothing bouncing back to the
  sender for days.

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
| AWS | Usage-based. DynamoDB, Lambda and SES are near-free at this volume; S3 and CloudFront are the ones that grow. CloudWatch logs used to be a third, growing forever because nothing set a retention — they now expire. |
| Cloudflare R2 | Storage, with **zero egress** — which is the whole reason reads come from it |
| Cloudflare Web Analytics | Free |
| Outlook | Per mailbox, if the plan hosting `@sharepix.net` is a paid one |
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
| Outlook subscription and its card | Per the plan | Mail stops arriving. Nothing bounces to the sender for days, so the first sign is a customer saying they never heard back. |
| R2 and Stripe API keys | Only if rotated | Rotating one means a redeploy, not just a paste |

## Access, honestly

Every account above is on one person. That is normal for a business this size
and it is worth naming rather than discovering: there is no second administrator
on AWS, no shared Stripe login, and no recovery path that does not run through
one email address and one phone.

That email address is on Outlook, which makes it the root of the whole set
rather than one account among them: anyone who can read it can reset AWS,
Stripe and Cloudflare in turn. It deserves the strongest authentication of
anything on this page.

The cheap mitigations, in the order they pay off:

1. **Recovery codes for AWS and Stripe MFA**, printed and somewhere physical.
2. **A second AWS account with admin**, so a lost phone is an inconvenience.
3. **A password manager the accounts actually live in**, rather than a browser.
