# Asking Minnesota whether SharePix is taxable

**Answered 16 September 2026: not taxable.** The Minnesota Department of
Revenue's Sales & Use Tax Division, Policy Services, in writing:

> Since you don't supply any content of your own and customers only access or
> download their existing photos, your service does not include taxable digital
> products.
>
> If your service is online-hosted software or a digital access service and not
> prewritten software or specified digital product, charges for accessing or
> hosting customer content in a browser-based environment are nontaxable under
> Minnesota Department of Revenue rules.
>
> [On whether the $79 event plan and the $149/month subscription differ] No.
> Both models are nontaxable because the nature of the service remains the same
> in each scenario.

Email routing code **348_100855**. Keep the original mail: the Department's own
notice says the answer is advisory, rests on the facts as they were described,
and holds only under the law in effect at the time.

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

**So: stay unregistered, collect nothing, change nothing.** That is now a
determination rather than a default.

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

**Not taxable, as it turned out.** Nothing changed, and nothing needs to.

### What the answer does not cover

Read the Department's reasoning rather than only its conclusion. It turns on two
facts about the *service*: SharePix supplies no content of its own, and what
moves is the customer's own photographs in a browser. Anything that stops being
true of a thing SharePix sells is outside this answer.

**Prints are the live example.** A physical photograph, manufactured and shipped
to a buyer, is tangible personal property — not "online-hosted software or a
digital access service", and not something the letter asked about. The
Department's reasoning does not carry across: a print *is* a good SharePix
supplies, however the file got there. Prints went live after this question was
drafted, which is exactly how a scope gap opens without anyone deciding to open
one.

That is a question for the Department, not for this file to answer, and it is
asked in [mn-print-tax-request.md](mn-print-tax-request.md). Meanwhile
`amplify/functions/print-checkout/handler.ts` sets no `automatic_tax` at all, so
prints are sold with no tax calculation of any kind — correct while
unregistered, wrong the moment that changes. See
[go-live-prints.md](go-live-prints.md).

**Ask again if** SharePix starts selling content of its own, delivers anything
downloadable that originates here rather than with the customer, or adds another
physical good. The argument above is reusable; only the facts would change.
