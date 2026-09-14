# Going live with print ordering

**This already happened.** `PRODIGI_ENV` is `'live'` (flipped in #56) and
`STRIPE_SECRET_KEY` is an `sk_live_…` key, so a print checkout today charges a
real card and submits a real order to `api.prodigi.com`. Both halves are
flipped, which is the state this document was written to reach.

What is left is one **real order**, which has never been placed. The price
sheet under it was also wrong — badly enough that small orders lost money — and
that is now fixed; see below for what broke and what guards it.

> This file said "Prints run against Prodigi sandbox and Stripe test mode
> today" for months after that stopped being true, and so did the README. The
> guard meant to catch it was pinned to whether *this file still exists* —
> which going live does not change. It now reads `PRODIGI_ENV` instead.

## Pricing, and why it broke

Going live never re-checked Prodigi's prices. A quote on **14 September 2026**
disagreed with `lib/prints.ts` on every line, shipping was under-charged by
$1.80–$4.80 an order, and the three cheap sizes lost money on every sale. Three
things were wrong at once, and they are worth keeping apart:

1. **The costs were stale.** Four of five base costs and all five shipping
   figures had moved.
2. **Shipping was passed through at cost.** That still loses money: Stripe takes
   2.9% of the shipping the buyer paid.
3. **Stripe's $0.30 fixed fee was never charged for at all.** The gross-up
   divided by `1 - 2.9%` and stopped there.

### How it is priced now

An order of `n` copies is charged

```
(prodigiCost × 1.08 + profit × n + $0.30) / (1 - 2.9%)
```

which nets `profit × n` plus whatever of the buffer went unused. The percentage
is grossed into every line including shipping; the fixed fee is recovered once,
on the shipping line, because it is charged once per payment rather than per
print. Rounding is always up.

**Photo prints earn a flat $0.10.** They are a convenience, not a margin line.
Fine-art and framed prints keep the 50%-of-base rule.

`prodigiCost` carries **`PRODIGI_SAFETY`, an 8% buffer**, on base and shipping
alike. It is not margin — it is expected to go unused, and when it stops going
unused the answer is to update the catalog, not to keep it.

It is proportional to what Prodigi charges rather than a flat fee per print,
for two reasons. Which line carries the risk depends on the order: a single 4×6
is 98% shipping, while fifty 8×10s are mostly print cost — a buffer on shipping
alone left that second case at 7% cover. And a flat per-print surcharge big
enough to protect a $12 single order would add close to 50% to a 25-print
order, which is a bulk penalty sitting next to a bulk discount.

Unit prices round up to the **cent**, not the nickel. On a 39¢ print a nickel
is a 10% surcharge, and every copy pays it again.

### The headroom this leaves

| | One copy | Ten copies |
| --- | --- | --- |
| 4×6 | 9.03% | 16.23% |
| 5×7 | 8.93% | 14.43% |
| 8×10 | 8.75% | 11.22% |
| 11×14 | 35.12% | 54.16% |
| 12×16 | 23.44% | 26.77% |

That is how far Prodigi's costs can rise before an order goes negative. Prodigi
raised prices about 5% in July 2026; before the buffer existed these numbers
were 1.35%, 1.25% and 1.03%, so a rise that size turned every single-copy photo
order negative the day it landed.

The buffer buys time, not safety. What makes it enough is the weekly check
below: 8% only has to cover the few days between a price moving and the alarm
saying so. Widening the gap means widening the buffer, and the buffer is the
half the customer pays for.

### The check now compares prices

**Print provider check** used to confirm only that each SKU resolved. It now
quotes **one copy and two** of every product and compares three numbers against
the code: base cost, first-item shipping, and the plus-one shipping that only a
second copy reveals. A ✗ means a price moved, and the message says so.

`__tests__/print-provider-check.test.ts` pins the three hand-copied cost tables
— `lib/prints.ts`, `print-checkout`, and the check itself — to each other. It
cannot tell whether they are *right*; only Prodigi knows that. It can tell
whether they are the *same*, which is the half a test can own.

### It is checked every week, without anyone remembering

`daily-tasks` invokes the print check every **Monday** and compares the answer.
On a mismatch it logs `PRINT PRICE DRIFT`, which a CloudWatch metric filter in
`backend.ts` turns into the **`sharepix-print-price-drift`** alarm on the usual
SNS topic — see [alerting.md](alerting.md).

It invokes the check rather than quoting Prodigi itself, so there is no fourth
copy of the cost table. It runs last in the nightly job and swallows its own
errors: an unreachable Prodigi must never delay a host's expiry reminder.

Nothing at runtime ties the logged string to the metric filter, so
`__tests__/print-price-watch.test.ts` pins them to each other from both ends. A
reworded log line would otherwise leave the alarm silent and the dashboard
green — the original failure again, with better scenery.

> **`shipAdd` is still unverified.** Every plus-one shipping figure in the code
> is a guess inherited from the old price sheet, because a one-copy quote cannot
> see it. The two-copy quote above exists to measure it. Run the check after
> this deploys and correct any ✗ — it matters more than it used to, because the
> order modal now actively encourages larger orders.

## What was switched, and what rollback reverses

### 1. Prodigi → live

- Confirm a **payment method is on file** in the Prodigi (live) dashboard, or
  live orders won't fulfil.
- Copy the **Live** API key (it's different from the sandbox key —
  `sandbox-beta-dashboard.pwinty.com` vs the live dashboard).

### 2. Amplify secret → live Prodigi key

- Amplify → Hosting → Secrets → set **`PRODIGI_API_KEY`** to the **Live** key →
  Save.

### 3. Code toggle → `live`

- In `amplify/functions/print-fulfill/resource.ts`, change **`PRODIGI_ENV`** from
  `'sandbox'` to `'live'` (marked `>>> GO-LIVE TOGGLE <<<`). This is the only code
  change. Merge to `main` to deploy.

### 4. Stripe → live mode

- **`STRIPE_SECRET_KEY`** → the `sk_live_…` key (Amplify secret).
- Create a **live-mode** webhook endpoint in Stripe pointing at the same webhook
  Function URL, then set **`STRIPE_WEBHOOK_SECRET`** to that live endpoint's
  signing secret (test and live have separate endpoints + secrets).
- Optional but recommended: Stripe Dashboard → Settings → Emails → enable
  **"Successful payments"** receipts so customers get a payment receipt.

After changing secrets, **redeploy** (a fresh build re-bakes them). The
`PRODIGI_ENV` code change already triggers a build when merged.

## Verify after go-live — for free, first

**Global admin → Print provider check → "Check print provider"** quotes one
copy and two copies of each of the five sizes through the `/v4.0/quotes`
endpoint. A quote creates nothing: no order exists afterwards, nothing is
printed, nothing is charged, and there is nothing to cancel. Run it as often as
you like.

It proves four things:

- the **live API key authenticates** (a sandbox key answers `401` here),
- **Lambda can reach `api.prodigi.com`** (a blocked network path times out here
  exactly as it would mid-order),
- every **SKU and its required attributes** are valid in the live catalogue, and
- every **price matches what the code charges against** — base cost, first-item
  shipping, and plus-one shipping.

It does **not** exercise order creation or Prodigi's fetch of the signed asset
URL — those happen only on a real order. That code is identical to what sandbox
already proved across all five sizes; only the base URL and key change, and
those are precisely what the check covers.

## Verify with a real order

**Still not done.** This is the only part of the print path that has never run:
Prodigi creating an order, and Prodigi fetching the signed asset URL. The quote
check cannot reach either, by design — a quote never creates an order.

1. Place **one real order** of a cheap size (e.g. a 4×6) with a real card.
2. Stripe shows the payment; the webhook delivery returns `200` quickly.
3. The `print-fulfill` log (`/aws/lambda/…printfulfill…`) shows
   `Prodigi order submitted … prodigiOrderId: …`.
4. The order appears in the **live** Prodigi dashboard.
5. If you just wanted to test, **cancel/refund** promptly (Prodigi prints fast).

## When an order fails

A paid order that Prodigi rejects records `status: failed` on the `PrintOrder`
row with the reason in `error`, and then **throws** — which is what makes
`sharepix-print-fulfill-errors` fire (see `docs/alerting.md`). The customer has
been charged and nothing is printing, so this is meant to be loud.

It is tried **once**: async retries are set to 0, because a retry after Prodigi
may have already created the order would print and ship it twice.

On alert: find the row, read `error`, then either fix the cause and resubmit or
refund. The row keeps `stripeSessionId`, so the refund is one click in Stripe.

The likeliest causes, in the order they've bitten:

| `error` says | Cause |
| --- | --- |
| `Prodigi 401` | The API key is for the other environment (sandbox key against live, or vice versa) |
| `Prodigi 400` … attribute | A SKU's required attribute is missing or invalid in the live catalogue |
| Prodigi fetched the asset and failed | The signed URL expired (48h) or the object is gone |
| `PRODIGI_API_KEY is missing` | The secret didn't survive a redeploy |

## Rollback

Set `PRODIGI_ENV` back to `'sandbox'`, restore the sandbox `PRODIGI_API_KEY`, and
return Stripe to test keys. Redeploy.

## Pricing / catalog note

Catalog SKUs, base costs, and the profit rules live in `lib/prints.ts`, mirrored
by hand in `amplify/functions/print-checkout/handler.ts` and in the provider
check. All three are pinned to each other by test; see "Pricing, and why it
broke" above for how they are derived and what the check now verifies.

All five sizes — photo 4×6 / 5×7 / 8×10, fine-art 11×14, framed 12×16 — were
verified end-to-end in sandbox, including their required Prodigi attributes,
and all five quote cleanly against the live catalogue. Neither of those checks
looks at price, which is how the drift survived go-live.
