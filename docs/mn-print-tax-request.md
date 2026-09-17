# Asking Minnesota about the prints

A request for written guidance on the *physical prints*, and the reasoning
behind what it asks.

**Why a second letter.** The first one
([mn-sales-tax-request.md](mn-sales-tax-request.md)) asked about the service and
was answered on 16 September 2026: not taxable, because SharePix supplies no
content of its own and customers only reach their own photographs.

That reasoning does not carry to a print. A photograph on paper, manufactured
and posted to a buyer, is tangible personal property, and it *is* a good
SharePix supplies — however the image got there. The first letter never asked,
because prints went live after it was drafted.

**Nothing is accruing.** No print order has ever been placed, verified in
Stripe. That is what makes this a question to settle before the first sale
rather than an exposure to clean up after one. `print-checkout` sets no
`automatic_tax` at all today, which is correct while unregistered and wrong the
moment a registration exists — see [go-live-prints.md](go-live-prints.md).

**The hard part is not "are prints taxable".** It is who collects, given that
SharePix never touches the goods. Prodigi prints and ships direct to the buyer,
so there are two sales in a row and the answer decides whether SharePix
registers, whether Prodigi should be charging SharePix tax today, and whether a
resale certificate is owed. That is question 2, and it is the reason this is
worth asking rather than assuming.

---

## The draft

The block quote below is the letter, and it is the **only** copy of it. To get a
Word document to attach or post:

```
npm run letter:docx -- docs/mn-print-tax-request.md "SharePix print tax request.docx"
```

Edit the markdown and re-run; do not edit the `.docx`. The generator reads the
quote rather than carrying its own transcript of it, because the first Word
document in this project did carry one and the two drifted the first time
somebody changed only one. The signed-and-posted copy is a bad one to have to
diff. `__tests__/mn-print-tax-letter.test.ts` additionally fails if the price
table here stops matching `lib/prints.ts`.

> **Request for written guidance — sales and use tax on photographic prints
> sold online and shipped by a third-party fulfiller**
>
> SharePix LLC\
> 617 Locust Street #1001\
> Monticello, MN 55362\
> Minnesota Secretary of State: 1665522500020\
> Contact: Seth Calvin — seth@sharepix.net — (320) 295-2850
>
> We received written guidance from your office on 16 September 2026 (email
> routing code 348_100855) confirming that our event photo-sharing *service* is
> not subject to Minnesota sales and use tax. We are grateful for it, and this
> request is about something that guidance did not cover: we also sell physical
> photographic prints, and we would like to know our obligation before we make a
> sale rather than after.
>
> **What we sell**
>
> A customer viewing one of our online galleries can order a printed copy of a
> photograph in it. We offer five items:
>
> | Item | Price to the buyer |
> | --- | --- |
> | 4×6 in photo print | $0.39 each |
> | 5×7 in photo print | $0.66 each |
> | 8×10 in photo print | $2.33 each |
> | 11×14 in fine-art print | $22.79 each |
> | 12×16 in framed print | $54.79 each |
>
> Shipping and handling is charged as a **separate line item** — $12.27 on a
> single 4×6 order, for example, so a one-print order totals $12.66. Most of the
> price of a small order is that line.
>
> **How the sale is fulfilled**
>
> This is the part we are least certain about, so we want to describe it
> exactly.
>
> - The buyer pays **SharePix**. We are the party they transact with, on our
>   website, and our name is on the receipt.
> - We do not print anything and we never possess the goods. We place a
>   corresponding order with **Prodigi**, a print fulfilment company, and Prodigi
>   manufactures the print and ships it **directly to the buyer**. No SharePix
>   branding is on the package.
> - Prodigi invoices us at wholesale; we charge the buyer the price above. We
>   have not provided Prodigi with a Minnesota resale exemption certificate, and
>   we are not currently registered to collect Minnesota sales tax.
> - The image printed is a photograph the customer or their guest took and
>   uploaded to our service. We supply no imagery of our own. We note this only
>   because it was the fact your earlier guidance turned on; we assume it does
>   not change the character of a physical print, but we would rather be told
>   than assume.
> - Buyers may be anywhere in the United States. We are a Minnesota company with
>   physical presence here.
>
> **Our questions**
>
> 1. Are the printed items described above subject to Minnesota sales and use
>    tax when shipped to a Minnesota address?
> 2. In this arrangement, **who is the retailer required to collect** — SharePix,
>    who takes the customer's payment, or Prodigi, who manufactures and ships the
>    goods? If SharePix is the retailer, should we be issuing Prodigi a
>    Minnesota resale exemption certificate so that the wholesale purchase is not
>    itself taxed?
> 3. Is the separately stated **shipping and handling** charge taxable? It is a
>    large share of a small order, so the answer materially changes what a buyer
>    pays.
> 4. Does the fact that the image is the **customer's own photograph**, rather
>    than content we supply, affect the answer — as it did for our service?
> 5. If we are required to register and collect, is there a threshold below which
>    you would not expect us to, or does our physical presence in Minnesota
>    require registration from the first taxable sale?
>
> **Why we are unsure**
>
> Fact Sheet 164 addresses local sales and use taxes and Fact Sheet 146
> addresses the use tax, but our uncertainty is about the drop-shipment
> arrangement rather than the character of the goods: we are the seller of record
> without ever holding the property, and we cannot tell from the published
> guidance whether that makes us the retailer for collection purposes or puts the
> obligation on the fulfiller.
>
> We have made no print sales to date and are asking before the first one. We are
> happy to provide any further detail, including the Prodigi invoices and a
> sample order.
>
> [Signature]
>
> Seth Calvin, SharePix LLC

---

## Before sending

- Confirm the current submission route on **revenue.state.mn.us**. The first
  letter went to `salesuse.tax@cx.mn.gov` and was answered in a day; addresses
  change, and this file should not be trusted for one.
- Add the **EIN** if it was not on the first letter. Both identifiers make a
  request faster to answer.
- **Regenerate the `.docx`** so the attachment matches the markdown. The prices
  no longer need re-checking by hand — `__tests__/mn-print-tax-letter.test.ts`
  pins the table, the shipping figure and the one-print total to `lib/prints.ts`,
  because they moved once already and a letter quoting stale figures invites an
  answer to the wrong question.

## After the answer

**If prints are taxable and SharePix is the retailer:** register with the
Department, issue Prodigi a resale exemption certificate, add the Minnesota
registration in Stripe, and set `automatic_tax: { enabled: true }` in
`amplify/functions/print-checkout/handler.ts` — one line, mirroring what
`stripe-checkout` already does. Do them in that order: calculating tax before
the registration exists collects money there is no authority to collect.

**If Prodigi is the retailer:** nothing changes in this repository, but confirm
with Prodigi that they are collecting, and record the answer here.

**If not taxable:** record it here and change nothing, as with the service.

Either way, note what the answer rests on. The service determination turned on
one fact, and when that fact stopped covering a new product line nobody noticed
for months. The same will be true of this one.
