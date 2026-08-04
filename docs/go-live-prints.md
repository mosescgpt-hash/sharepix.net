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

## Verify after go-live

1. Place **one real order** of a cheap size (e.g. a 4×6) with a real card.
2. Stripe shows the payment; the webhook delivery returns `200` quickly.
3. The `print-fulfill` log (`/aws/lambda/…printfulfill…`) shows
   `Prodigi order submitted … prodigiOrderId: …`.
4. The order appears in the **live** Prodigi dashboard.
5. If you just wanted to test, **cancel/refund** promptly (Prodigi prints fast).

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
