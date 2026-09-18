# What SharePix costs, and how much to trust the number

`/global-admin → Costs`. One page for "do I have enough money for this month",
plus the records that answer it later.

The hard part was never the arithmetic. It is that a total looks identical
whether every figure behind it is a real bill or a number somebody typed in last
January — and this repository has a history of exactly that failure. The README
carries a section about claims that were true when written. A costs page is the
worst place to repeat it, because a wrong total there gets acted on.

So every figure is labelled with how it is known, and the page refuses to lead
with a total it cannot stand behind.

## The four kinds of figure

| | What it means | Which accounts |
| --- | --- | --- |
| **measured** | Came from the provider's own API. This is the bill. | AWS, Stripe |
| **computed** | Derived from data SharePix owns, priced at rates recorded in `lib/costs.ts`. Right as long as the rates are. | Cloudflare R2, Prodigi |
| **declared** | Somebody typed it in. Right on the day they typed it. | Microsoft 365, the domain |
| **free** | No charge at this volume. Listed so the absence is a decision. | GitHub, Web Analytics, Search Console |

A declared figure shows its age and turns red past
`DECLARED_STALE_AFTER_DAYS` (90). That is not an accounting rule — it is an
admission that whoever entered $6 in January has no idea whether it is still $6.

## The number at the top is not the total

It is **what has to come out of your own pocket**, which is the total minus the
pass-through costs.

Prodigi's bill and Stripe's fees are real costs, and they are in the records.
They are not money to find: a print order arrives already funded by the buyer
who placed it (see [go-live-prints.md](go-live-prints.md) for how the price is
built), and an order that never happens costs nothing. Counting them as cash to
have ready inflates the figure by the one part that pays for itself.

`passThrough` in `COST_ACCOUNTS` is what decides this, and
`__tests__/costs.test.ts` pins the list to exactly Stripe and Prodigi. Getting
it wrong is the difference between "have $40 ready" and "have $400 ready".

## What it refuses to do

**Report an unreachable provider as zero.** A failed fetch becomes a line
reading *unknown* with the reason, the summary counts it as a gap, and the
headline changes to "at least $X — the real figure is higher". Zero is the
answer that lets you believe a total that is short.

**Project a month from two days.** Below `PROJECTION_MIN_ELAPSED` of the month
the page says it is too early rather than multiplying up. Same conservatism as
the monthly report's `headline()`.

**Recompute anything in the browser.** The page renders the totals the Lambda
computed. Two implementations of a money figure diverge eventually, and the
filed report would be the one that was wrong.

**File a period that is not a whole month or year.** `reportIdFor` returns null
for anything else, so a row labelled "12 Aug to 3 Sep" cannot end up sitting
between the months in the records.

## Where each number comes from

**AWS** — Cost Explorer, `GetCostAndUsage` with `UnblendedCost`, grouped by
service, plus `GetCostForecast` for the rest of the month. Unblended rather than
amortized: amortized spreads reservations across the month, which reads better
and is not what leaves the bank. Route 53, SES, S3, CloudWatch and WAF are all
inside this one figure.

**Stripe** — balance transactions for the period, summed on `fee`. Not 2.9% +
30¢ recomputed from the charge: that is right until a currency conversion, a
dispute fee or a rate change makes it wrong, and it would be wrong silently.

**Cloudflare R2** — the GraphQL analytics API gives stored bytes and operation
counts; `r2CostUsd` prices them at `R2_RATES`, after the free tier, per
component. Cloudflare has no "what do I owe" endpoint, which is why this is
computed rather than measured. **Nothing in this repository can check the
rates** — same standing as the Prodigi catalogue, but without a weekly check to
catch a change, so `R2_RATES_VERIFIED_ON` is shown next to the figure.

**Prodigi** — derived from the `PrintOrder` rows in the period via
`PRODIGI_SHARE`, a deliberately conservative fraction of what the buyer paid.
It is an estimate of a real obligation, not a record of one. When Prodigi's
invoices are wired up that constant goes away rather than being tuned.

**Declared costs** — an `AppSetting` row, edited in the tab, stamped with the
date you saved it.

## The domain is the one that can be counted twice

[accounts.md](accounts.md) says `sharepix.net` is *believed* to be registered
through Route 53. If it is, the renewal is already inside the AWS figure, and
declaring it again double-counts. Believed is not knowledge, so the field warns
rather than guessing — enter 0 if Route 53 bills it.

## What it costs to look at this page

Cost Explorer bills **$0.01 per request**. A page that refetched on render would
turn a page about spending into spending, so:

- opening the tab reads a **six-hour cache**,
- only **Refresh** spends a request, and the button says so,
- the scheduled filing on the 1st spends two a year's worth — twelve, plus one
  for the annual report.

Call it fifteen cents a year if nobody presses Refresh, and a few dollars if
somebody presses it constantly.

## The records

A report is filed automatically at 15:00 UTC on the 1st for the month that just
ended, and on 1 January for the year as well. It rides `monthly-report`, which
already has one definition of "last month", rather than a second schedule
existing to disagree with it. Filing invokes `cost-summary` rather than
recomputing — the same reason `daily-tasks` invokes the print check instead of
quoting Prodigi itself.

Reports are kept in the `FinancialReport` model, keyed by period (`2026-09`,
`2026`), so re-filing replaces rather than duplicating. Two rows for September
that disagree, with no way to tell which is the record, is worse than no record.

They are **stored**, not only emailed. A record that lives in a mailbox is one
mailbox problem away from gone, and [accounts.md](accounts.md) is explicit that
the Outlook mailbox is the root of every other account's recovery.

The CSV download keeps the provenance column and the unreachable lines. A report
that silently drops the costs it could not reach reconciles to the wrong figure.

## What it does not cover

`COSTS_NOT_COVERED` is printed on the page and in every CSV. The short version:
anything bought outside these accounts, tax owed, chargebacks, and next month.

And the line that matters most: **this is a cash view, not accounting.** Nothing
here is accrued or depreciated, and none of it is fit to file as-is.
