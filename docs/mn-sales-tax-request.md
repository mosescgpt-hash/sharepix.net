# Asking Minnesota whether SharePix is taxable

**Sent 16 September 2026.** Awaiting a determination; nothing else is needed
until one arrives — see "After the answer" at the end for what each outcome
means.

The request for written guidance from the Minnesota Department of Revenue, kept
here with the reasoning behind what it does and does not say. Keep it: if the
answer is slow, or arrives ambiguous, or the service changes and the question
has to be asked again, the argument is the expensive part and it is already
made.

**Why ask at all.** SharePix LLC is registered in Minnesota, so physical
presence creates nexus here regardless of sales volume — Minnesota is the one
state that is not waiting for a threshold. But nexus only matters if what
SharePix sells is taxable, and that is genuinely unsettled: Minnesota taxes
*specified digital products* and generally does not tax software delivered as a
service, and SharePix can be argued into either bucket. Getting it wrong in
either direction costs money, so it is worth asking rather than deciding.

**While it is outstanding**, the position is unchanged and safe: SharePix is not
registered to collect Minnesota sales tax and is not collecting any. That is the
correct posture for a business that has asked whether it should be.

**Nothing needs to happen in Stripe first.** `automatic_tax` is already on and
calculates zero for every jurisdiction without a registration, so no liability
is accruing while this is outstanding. Do not add a Minnesota registration in
Stripe until the answer is in — the moment one exists Stripe starts charging
Minnesota customers, and over-collecting is its own problem.

---

## The draft

> **Request for written guidance — sales and use tax treatment of an online
> event photo-sharing service**
>
> SharePix LLC
> 617 Locust Street #1001
> Monticello, MN 55362
> Minnesota Secretary of State: [file number]
> Federal EIN: [EIN]
> Contact: Seth Calvin — seth@sharepix.net — (320) 295-2850
>
> We are a Minnesota limited liability company and we are not currently
> registered to collect Minnesota sales tax. We are asking for written guidance
> on whether the service described below is subject to Minnesota sales and use
> tax, so that we can register and collect correctly if it is.
>
> **What we sell**
>
> A customer — typically someone hosting a wedding, a company party or a church
> event — pays us to host a shared photo gallery for that one event. What they
> receive is:
>
> - A web page we host, at a URL on our domain, holding photographs uploaded to
>   that event.
> - A QR code and printable signs pointing guests at that page.
> - Access to that page for a defined period. Our paid per-event plan is $79,
>   one time, and provides a 60-day window during which photographs may be
>   added and 12 months of access to the gallery afterwards. We also offer a
>   free plan with shorter retention, and a $149/month subscription for
>   businesses running events throughout the year.
>
> **What we do not sell**
>
> We want to be precise about this, because we believe it is the point on which
> the answer turns.
>
> - We do not sell any content to the customer. Every photograph in a gallery
>   was taken and uploaded by the customer or by their guests. It is their
>   material. We never provide the customer with photographs, video, music,
>   books or any other content originating from us.
> - We do not deliver software. Nothing is downloaded or installed as a
>   condition of the sale. The customer uses the service through an ordinary web
>   browser. There is no product key, no application, and nothing the customer
>   retains if they stop paying.
> - We do not transfer any permanent right to anything. Access ends when the
>   retention period ends, after which we delete the stored files.
>
> Guests can download copies of the photographs from a gallery. We note this
> because it involves a file transfer, but the files being transferred are the
> guests' and the customer's own photographs, uploaded by them, not content sold
> by us.
>
> **Our question**
>
> 1. Is the service described above subject to Minnesota sales and use tax?
> 2. If it is, under what classification — for example as a *specified digital
>    product*, as *computer software*, or as some other taxable item or service?
> 3. If the answer differs between the one-time per-event charge and the monthly
>    business subscription, we would appreciate guidance on both.
>
> **Why we are unsure**
>
> Minnesota Sales Tax Fact Sheet 177 addresses digital products and Fact Sheet
> 134 addresses computer software. Reading both, we are unable to place this
> service with confidence: it involves electronically transferred files, which
> points one way, but the files are the customer's own content and the customer
> receives no software and no permanent rights, which points the other. We would
> rather have your determination than act on our own reading.
>
> We are happy to provide any further detail, including access to a sample
> gallery. Thank you.
>
> [Signature]
> Seth Calvin, SharePix LLC

---

## What was filled in

The **Secretary of State file number**, plus the signature and date.

The **EIN** was the other identifier the draft asked for. Both name the
taxpayer, and a request carrying them is answered faster — so if the EIN did not
go on, expect the Department to ask for it before they rule, and have it ready
rather than treating the question as a setback.

Neither number is recorded in this repository, deliberately: they belong in
[business-records.md](business-records.md) with the rest of the filings rather
than in a letter.

## What was deliberately left out

- **Any assertion of the answer.** A request that argues for a conclusion
  invites a reply addressing the argument rather than the facts. The question is
  the question.
- **Revenue figures.** They do not bear on classification, and Minnesota nexus
  here comes from physical presence rather than from a volume threshold.
- **Other states.** One jurisdiction per request. Every other state is on the
  economic-nexus tripwire in `lib/taxNexus.ts` and is not yet anybody's problem.

## After the answer

**If taxable:** register for a sales tax account with the Department (through
their e-Services system — again, confirm the current route on their site), then
add the Minnesota registration in the Stripe dashboard. Stripe begins
calculating from that point. Nothing in this repository needs to change:
`automatic_tax` is already enabled in `stripe-checkout`, which is exactly why
it was switched on before any registration existed.

**If not taxable:** record the answer somewhere it will be found again — this
file is a reasonable home — and change nothing. Revisit if the service changes
materially, particularly if SharePix ever begins selling content of its own
rather than hosting the customer's.
