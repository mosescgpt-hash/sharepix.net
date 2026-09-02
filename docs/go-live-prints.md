# Going live with print ordering

Prints run against **Prodigi sandbox** and **Stripe test mode** today. Going
live means flipping **both** together — never one without the other:

- **Stripe live + Prodigi sandbox** → real charge, no real print (customer paid,
  nothing ships).
- **Stripe test + Prodigi live** → real print + real Prodigi charge to you, no
  real payment collected.

Do all four parts in one sitting.

## The four-part switch

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

A green result reports the per-print and shipping cost Prodigi quoted, which is
also a free check that `lib/prints.ts`'s base costs are still right.

It does **not** exercise order creation or Prodigi's fetch of the signed asset
URL — those happen only on a real order. That code is identical to what sandbox
already proved across all five sizes; only the base URL and key change, and
those are precisely what the check covers.

The check's SKU/attribute table is duplicated from `print-fulfill` by hand, and
`__tests__/print-provider-check.test.ts` fails the build if the two drift — a
check quoting a different product than fulfilment orders would prove nothing.

## Verify with a real order

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
price sheet; re-check base costs against the live pricing sheet before launch so
the margin math (base + profit, grossed up for Stripe's fee) stays correct. All
five sizes — photo 4×6 / 5×7 / 8×10, fine-art 11×14, framed 12×16 — were verified
end-to-end in sandbox, including their required Prodigi attributes.
