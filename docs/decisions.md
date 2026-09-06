# Product decisions

Decisions that settle a question the strategy documents left open, or that
supersede what those documents assume. Each one names what it overrides, so a
document can be read later without re-deriving which of its numbers are live.

The documents themselves are not in this repository. They are referred to by
title.

---

## 1. Retention — 60-day upload window, 12-month gallery

**Decided.** Shipped.

- Guests can upload for **60 days** from event creation, extendable in 30-day
  blocks for half the plan price.
- After the window closes the gallery stays available for **12 months** —
  guests at reduced resolution, the host with full access and downloads for the
  whole period.
- Then a 90-day private archive (admin-restorable), then permanent deletion.

**One policy for every plan on sale.** Retention used to be a tier
differentiator — 3 weeks on Starter, 3 months on Standard, 1 year on Premium —
which made the single most important sentence on the site, *how long do I keep
my photos*, impossible to answer without a table. Plans now differ on capacity
and features. Events on a retired plan keep the shorter windows they were sold
with; those rows describe what a plan **was** and editing them rewrites history.

**Supersedes** *SharePix Retention, Lifecycle & Extensions v1.0*, which
specifies a 90-day upload window. Sixty, not ninety: it is comfortably past the
point where a guest has emptied their camera roll, and it is short enough that
the paid extension remains a real product rather than a formality.

**Consequences for the research documents.** Any survey question that asks a
host to validate "guests can upload for 90 days" is asking about a product
they did not use. The 12-month gallery question is fine as written. Affected:
*Post-Event Research Survey Template v1.0* Q29, *Founding Events Analytics &
Research Survey v1.0* Q27, *Guest Upload Promise v1.0*.

**A note on the anchor.** The documents measure both periods from the *event
date*; the code measures from event creation, and the 12 months runs from the
window closing rather than from creation. What a customer actually gets is
therefore the window **plus** twelve months. The promise is met early rather
than missed on a rounding argument about when an event "started". If we ever
need the two to agree exactly, that is a schema change (storing an event date
as a lifecycle anchor), not a constant.

---

## 2. Research incentive — $25 Amazon gift card, sent by hand

**Decided.** Not built.

A **$25 Amazon gift card** for completing the post-event survey, issued
manually. No cash refunds, no SharePix account credit.

**Supersedes** the two other mechanisms that appear across the set: the cash
partial-refund model and the SharePix-credit model. *Manual Amazon Gift Card
Research Incentive v1.1* is the operative document — it is the later revision,
and it is also the only one of the three that does not collide with a refund
cap or create a redeemable balance we would have to account for.

Manual issuance is the point, not a limitation to engineer away: at the volumes
this programme runs at, a person sending a gift card is cheaper and far less
risky than an automated payout path, which would be a new class of fraud
surface on a product whose only current money movement is inbound through
Stripe.

**Blocked on** a definition of "Successful Event" and contributor counting
(neither exists), and on scheduled jobs plus transactional email to send the
survey at all. See *What has to exist first* below.

---

## 3. Pricing — one paid plan at $79, plus a free trial event

**Decided.** Shipped.

| Plan | Price | Photos | Videos | Gallery |
| --- | --- | --- | --- | --- |
| Free | $0, one per account | 50 | 1 | 30 days |
| Event | $79 one-time | 3,000 | 30 | 12 months |

The paid plan includes everything: customizable QR code, event branding,
approve-before-showing moderation, the guest book and the live slideshow.
Nothing is sold on top of it. Corporate stays at $149/month, keeps its own
page, and is a line of prose under the cards rather than a third card — a
monthly subscription beside one-time payments reads as a price to compare when
it is not comparable.

**Why one plan.** The previous $39/$89 split differentiated on capacity, which
asked a host to predict how many photos an event that has not happened yet
would produce. Nobody can do that, and faced with an unevaluable difference
people take the cheaper option — so the split did not price-discriminate, it
discounted. Putting the live slideshow and guest book in the base plan also
turns the product's best demonstration from a revenue line into something every
customer actually sees.

**Why the free event rather than a cheap tier.** A stripped paid tier makes a
bad first impression permanent. A free event makes a good one, and it produces
the real events, demos and proof that most of the strategy documents are
starved for. It is capped at 50 photos and 1 video with a 30-day gallery, and
limited to one per account — one ever, not one at a time.

**Two implementation notes that matter for later.**

- The paid plan keeps the internal tier id `plus`, not `event`. `plus` was
  already the all-in plan, so $89 → $79 is a price cut on a tier whose meaning
  did not change. Redefining `event` from $39-basic to $79-everything would
  rewrite an id that an unpaid event row could be carrying. For an event that
  already exists, a price may only ever move down.
- One free event per account is enforced by `FreeEventClaim`, a row keyed by
  the host's Cognito sub that the browser cannot read, write or delete — only
  the create-event Lambda writes it, with a conditional put, so two
  simultaneous requests cannot both win. Deleting the event does not return the
  claim. An admin can delete the row to grant another.

**Supersedes** the $49 assumption used throughout the research documents. The
knock-on effects, which nothing has yet been re-run against:

- The two-stage research math ($25 incentive + $24 residual = $49) does not
  hold at $79. The residual is $54.
- *Unit Economics Model v1.0* has no $79 row and no free tier at all. Its
  sensitivity analysis needs rebuilding before any of its conclusions are
  quotable, and it now needs a free-event cost line: roughly 50 photos and one
  video held for about three months, which is cents per account but is not zero
  and scales with sign-ups rather than with sales.
- Any survey question that states or implies a price needs correcting before it
  is sent.

**The open exposure.** One free event per *account* is not one per *person* —
someone can make more accounts. Email verification at sign-up is the only
friction on that today, and it is the axis to watch if free events start
appearing faster than sign-ups justify.

---

## 4. Legal entity — SharePix LLC

**Decided.** Already correct in the codebase.

`LEGAL_ENTITY` in `lib/businessInfo.ts` is **SharePix LLC**, and every public
page, the DMCA designation and the Terms/Privacy effective date of
September 5, 2026 follow from it.

**Supersedes** *SharePix Legal Document Package v1.0*, which names **Calvin
Solutions LLC** and cites Terms and Privacy dated July 28, 2026. Both are stale.
That document should not be filed, sent to a counterparty, or used as the
source for any external registration in its current form.

External records carrying the entity name cannot be updated from this
repository — see `docs/business-records.md` for the list that actually goes
stale.

---

## 5. Successful Event — 3 contributors and 10 guest uploads

**Decided.** Shipped, in `lib/successfulEvent.ts`.

    Successful Event = at least 3 unique guest contributors
                       AND at least 10 guest uploads

Both halves, never one. Ten uploads from one person is a host testing their own
event; three people uploading once each is a gallery nobody came back to. The
pair is what says the QR code actually went round a room. Thresholds are
configurable; the numbers come from the Monthly Analytics Email Report brief.

**It is admin-facing only.** "Your event was unsuccessful" is a horrible
sentence to put in front of someone whose wedding it was. The number exists to
tell us whether the product works, not to grade a customer.

**Counting is cumulative, not live.** A host deleting a photo later does not
un-count the guest who uploaded it — an event must not become retroactively
unsuccessful because someone tidied their gallery. The only thing that
decrements is an upload whose record failed to write, because that upload never
happened.

**Guest versus host is decided server-side** from the caller's verified Cognito
identity against the event's stored owner, never from the `uploadedByUserId`
the request supplies. Otherwise anyone could mark their uploads either way and
the metric would measure nothing.

**How much weight it can carry.** A contributor is identified by the name or
per-browser label attached to an upload, which is a client-supplied string. It
cannot be forged by accident but it can be forged on purpose, and the incentive
becomes real once this gates a $25 gift card. That is survivable *only* because
the gift card is issued by hand — a person looks at the event before paying.
Treat it as a good measure and a weak control, and do not wire it to anything
that spends money on its own.

**A gap that came with it.** The upload form had always told guests "if left
blank, this browser gets a reusable guest label". It did not — every unnamed
upload was stored as "Anonymous", so one person's six photos and six people's
one photo each were indistinguishable. That is now real (`lib/guestLabel.ts`),
scoped per event so it never becomes a cross-event identifier for people who
never made an account. Uploads made before it existed are not counted toward
this metric: "Anonymous" is treated as *cannot tell*, which is neither one
person nor forty. Historical events therefore have an honest gap rather than a
back-filled guess.

## 6. Scheduled work and email — daily job, and a real opt-out

**Decided.** Shipped, sending switched **off**.

A daily Lambda at 14:00 UTC (`amplify/functions/daily-tasks`), which is the
first thing in SharePix that has ever run on a clock. Verified against a real
CDK synth: it produces an `AWS::Scheduler::Schedule` with
`cron(0 14 * * ? *)`, timezone UTC, targeting the function.

A fixed hour rather than `every day`, which anchors to deploy time and moves
whenever we ship — eventually mailing half the audience at 3am.

**It ships unable to send.** `EMAIL_SENDING_ENABLED` gates every send and is
unset, so the job runs, scans, decides exactly who it would email and logs all
of it, and sends nothing. Nothing is recorded as sent during a dry run either,
so switching it on later sends the reminders that were due rather than skipping
them as already done. **Turning it on is a deliberate act**, and should follow
watching a few days of dry-run logs.

**The first job: gallery expiry reminders** at 60, 30 and 7 days, from the
retention brief. Idempotent through an `EventNotification` row per event per
milestone — a scheduler that double-fires cannot mail anyone twice, and the
claim happens *before* the send, so a crash costs a reminder rather than
duplicating one. Milestones that go by unsent are recorded as lapsed rather
than retried: "60 days left" delivered to an event with nine is worse than
silence.

**The essential/optional line** (`lib/emailPreferences.ts`) is the part worth
getting right. Essential is mail about an event someone owns and is about to
lose; optional is everything we send because we want something. A host who
opted out of a newsletter in March must not lose their wedding photos in
December because of it — so essential mail ignores the opt-out, and, equally,
never carries an unsubscribe link inviting someone to turn off the one message
they will wish they had read.

Every kind of email is categorised in one exhaustive table, so adding a new one
is a deliberate decision about whether people can refuse it.

**Unsubscribe** is a token, not just an address: the link carries a random value
checked against the stored one, so nobody can opt a stranger out by guessing
their email. The page needs a click — mail scanners follow links before a human
sees them, and a GET that unsubscribed on arrival would silently opt people out
of mail they never chose to leave.

**Still open.** The retention brief also specifies a paid **12-month gallery
extension**, which does not exist — we sell 30-day upload-window extensions,
which is a different product. Until that ships the reminder tells hosts to
download rather than offering to sell them time. That is a pricing decision,
not a build.

## What has to exist first

Roughly seven of the strategy documents key off a **Successful Event** metric
and a **contributor count**. Every lifecycle programme in them — Founding
Events outreach, the post-event growth loop, the monthly report, sending the
survey at all — additionally needs **scheduled jobs** and **transactional
email**.

1. ~~Define Successful Event; count contributors per event.~~ **Done** — see
   decision 5 above.
2. ~~Scheduled jobs and transactional email.~~ **Done** — see decision 6 below.
3. Then one customer-facing programme at a time, on top of both.

Documents describing programmes at layer 3 cannot be built before 2, however
complete they are.

**Analytics is a fourth gap**, separate from these: there is no provider and no
event tracking, which is the whole of *Funnel & Product Health* and most of
*Intent Detection & Personalized Experiments*. The funnel those documents
describe starts at website visitors, and nothing upstream of "event created" is
measured today.
