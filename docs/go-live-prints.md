# Going live with print ordering

**This already happened.** `PRODIGI_ENV` is `'live'` (flipped in #56) and
`STRIPE_SECRET_KEY` is an `sk_live_…` key, so a print checkout today charges a
real card and submits a real order to `api.prodigi.com`. Both halves are
flipped, which is the state this document was written to reach.

What is left is in two places: the **price sheet** below, which is wrong and is
costing money on every order, and one **real order**, which has never been
placed.

> This file said "Prints run against Prodigi sandbox and Stripe test mode
> today" for months after that stopped being true, and so did the README. The
> guard meant to catch it was pinned to whether *this file still exists* —
> which going live does not change. It now reads `PRODIGI_ENV` instead.

## The price sheet is stale

`lib/prints.ts` carries Prodigi's base costs and shipping from the US price
sheet. **Print provider check** quotes the live catalogue, so it reports what
Prodigi actually charges — and on **14 September 2026** the two disagreed on
every line:

| Size | Base in code | Base quoted | Shipping in code | Shipping quoted |
| --- | --- | --- | --- | --- |
| 4×6 | $0.15 | $0.25 | $8.95 | $10.75 |
| 5×7 | $0.65 | $0.50 | $8.95 | $10.75 |
| 8×10 | $2.00 | $2.00 | $9.95 | $11.85 |
| 11×14 | $12.00 | $14.00 | $9.95 | $11.85 |
| 12×16 | $39.00 | $40.00 | $20.00 | $24.80 |

Shipping is the expensive half: it is meant to be a pass-through, and it is
under-charged by **$1.80 to $4.80 an order**. Because SharePix's whole margin
is the per-print profit, a shipping shortfall comes straight out of it — and
the three cheap sizes are smaller than the shortfall, so a single 4×6, 5×7 or
8×10 order **loses money**:

| Size | Intended profit | Actual, one copy |
| --- | --- | --- |
| 4×6 | $1.50 | **−$0.96** |
| 5×7 | $1.50 | **−$0.72** |
| 8×10 | $1.50 | **−$0.99** |
| 11×14 | $6.00 | $1.52 |
| 12×16 | $10.00 | $3.31 |

There is a third, separate gap. `printUnitPrice` grosses up by Stripe's
*percentage* fee only — it divides by `1 - STRIPE_PCT` and never accounts for
the **$0.30 fixed fee**. Correcting both tables above still leaves a cheap
print earning about **$0.85** against a $1.50 floor, because that $0.30 is a
fifth of the floor. Whether to raise `PRINT_MIN_PROFIT` or fold the fixed fee
into the gross-up is a pricing decision, not a bug fix.

Re-run **Print provider check** before trusting any of these numbers: it costs
nothing and Prodigi's sheet moves.

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

**Global admin → Print provider check → "Check print provider"** asks Prodigi to
price one copy of each of the five sizes through the `/v4.0/quotes` endpoint.
A quote creates nothing: no order exists afterwards, nothing is printed, nothing
is charged, and there is nothing to cancel. Run it as often as you like.

It proves the three things that actually differ between sandbox and live:

- the **live API key authenticates** (a sandbox key answers `401` here),
- **Lambda can reach `api.prodigi.com`** (a blocked network path times out here
  exactly as it would mid-order), and
- every **SKU and its required attributes** are valid in the live catalogue.

A green result also reports the per-print and shipping cost Prodigi quoted,
which is the only free way to check `lib/prints.ts` against reality. Nothing
compares them automatically — read the numbers, or the drift above happens
again.

It does **not** exercise order creation or Prodigi's fetch of the signed asset
URL — those happen only on a real order. That code is identical to what sandbox
already proved across all five sizes; only the base URL and key change, and
those are precisely what the check covers.

The check's SKU/attribute table is duplicated from `print-fulfill` by hand, and
`__tests__/print-provider-check.test.ts` fails the build if the two drift — a
check quoting a different product than fulfilment orders would prove nothing.

## Verify with a real order

**Still not done.** This is the only part of the print path that has never run:
Prodigi creating an order, and Prodigi fetching the signed asset URL. The quote
check cannot reach either. Fix the price sheet first, or this test loses money
as well as proving something.

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

Catalog SKUs, base costs, and the profit rules live in `lib/prints.ts` (mirrored
in `amplify/functions/print-checkout/handler.ts`). They came from the Prodigi US
price sheet, and **they are out of date** — see "The price sheet is stale"
above. That section is the live comparison; this one is only where the numbers
live.

All five sizes — photo 4×6 / 5×7 / 8×10, fine-art 11×14, framed 12×16 — were
verified end-to-end in sandbox, including their required Prodigi attributes,
and all five quote cleanly against the live catalogue. Neither of those checks
looks at price, which is how the drift survived go-live.
