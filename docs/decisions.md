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

**Supersedes** the two other mechanisms proposed as *research incentives*: the
cash partial-refund model and the SharePix-credit model. *Manual Amazon Gift
Card Research Incentive v1.1* is the operative document.

**This does not supersede refunds.** Those are a different thing entirely and
were never in question: **money owed back goes back to the original payment
method.** A gift card is what someone earns for doing research; a refund is what
someone is owed when the product did not do its job. Conflating them — as an
earlier draft of this file did — makes the Guest Upload Promise look decided
against when it is not, and would eventually have someone offering a gift card
to a customer asking for their money back.

One consequence of separating them: because the research incentive is **not** a
refund, it does not consume refundable amount. The brief's stacking example
(`$49 paid − $25 research refund = $24 maximum`) no longer applies. A Guest
Upload Promise claim can return the full purchase price even to someone who also
received a gift card.

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

## 7. The research survey and its gift card — built, switched off

**Decided.** Shipped, dormant.

A host whose event was a Successful Event is invited, once, some days after
their upload window closes. Completing the survey creates a **$25 gift-card
obligation** in an admin queue. A person buys and sends every card by hand.

**Nothing automated can mark a card sent.** `AWAITING_MANUAL_FULFILLMENT →
FULFILLED` is the only route into fulfilment, and the only thing that can take
it is an admin pressing a button in the dashboard. The completion endpoint —
the one a stranger with a link can reach — cannot write that status at all.

**Eligibility never depends on what the feedback said.** Not a rating, not a
recommendation, not a testimonial, not permission to use their photos.
Criticism earns exactly the same $25. This is enforced rather than promised:
`eligibilityFor` is given no access to the answers, so the discrimination
cannot be written by accident, and a test asserts the input type stays free of
every sentiment field.

That is not politeness. Research paid for on condition of approval buys
agreement and then reports it as evidence, and every decision made on it
afterwards is made on something we told ourselves.

**Three switches, all off:**

| Setting | Effect when unset |
| --- | --- |
| `EMAIL_SENDING_ENABLED` | Nothing is ever sent |
| `RESEARCH_SURVEY_URL` | No invitations, even with sending on |
| `RESEARCH_FULFILMENT_DAYS` | No delivery time is promised |

**The survey lives elsewhere.** The form provider is configuration, so choosing
one is not a code change. The page we own explains the deal, sends people out,
and takes their word when they come back — because a human checks the actual
response before paying, a claimed completion is a queue item rather than a
payment, and building a tamper-proof completion signal would be more work than
the check already happening.

**Before this can run:** the survey questions still say 90 days and imply $49.
Both are wrong — 60 days and $79. Sending them as written would collect
opinions about a product nobody used.

## 8. The guest-to-customer loop, and how it is measured

**Decided.** Shipped, live.

Everyone who uploads a photo at somebody else's event has just used SharePix
and knows what it does — the cheapest audience the product has. After a
successful upload they see one quiet line offering to create their own event.

**Quiet is the specification, not a preference.** A link rather than a button,
small type, below the success notice, no account asked for. The guest came to
give someone else their photos, and the moment that works is not a moment to
sell into. If it competes with "your photos were added", it is wrong.

**Only Part 15 of the growth-loop brief is built.** That document is 22 parts
and spans a rating flow, testimonials, featured events, a referral programme
with a credit ledger, and a retention workflow that is already done (decision
6). The guest loop is the part that is self-contained, needs no guest email
address — we have none, and guests have no account — and acquires customers.

### Attribution without analytics

The brief asks for four tracked steps: CTA shown, clicked, signup started,
purchase completed. Three of those need an analytics provider, which does not
exist. Rather than pretend otherwise, the **last** step — the one worth money —
is recorded in our own database as a `source` on the event row.

That survives ad blockers, consent banners and whatever provider is chosen
later. Impressions and clicks can be layered on when there is something to
layer them onto; the conversion is the part that would hurt to lose.

**`source` is a closed set, validated server-side.** It arrives as a URL
parameter, which means it arrives from anyone, and it is then stored, shown in
the admin dashboard and eventually counted in a report. Free text there is a
stored-content hole and a data-quality one at the same time. Anything
unrecognised becomes `direct`, silently — an unrecognised source is a mis-typed
link, and losing the attribution is the right cost. Refusing to create the
event would not be.

Events created before this count as `direct`, which is not quite true — they
are *unknown* — but a fifth bucket for "we were not measuring yet" would put a
permanent asterisk on every chart for a handful of early rows.

## 9. The monthly report — only what is measured

**Decided.** Shipped. Goes to **seth@sharepix.net**.

A second scheduled job, 15:00 UTC on the 1st, summarising the calendar month
that just ended so every figure in it is final.

**The rule: report what is measured, say what is not, never print a zero for
something nobody counts.** The brief for this report assumes a central
analytics system tracking website traffic, a purchase funnel, refunds, unit
economics, experiments, visitor intent, referrals and support burden. Almost
none of that exists. A report that renders those sections anyway — *"Visitors:
0. Refunds: 0. CAC: $0.00"* — is worse than one that omits them: every figure
on the page becomes suspect, and within two months nobody opens it.

So it carries what has real numbers behind it — events created, paid versus
free, Successful Events and the rate, guest uploads, contributors, hosts who
were guests first, surveys completed, gift cards owed right now — and prints a
standing list of what is absent **and why**. That list shrinking is itself a
useful signal.

**It refuses to over-claim.** A percentage change from a base of zero is not
reported at all, and the headline says "still too few for month-over-month
percentages to mean much" below ten events a month rather than declaring a
trend from two events to three. The cost of a wrong headline is that the right
one stops being believed.

The recipient is defaulted in `amplify/backend.ts` (and mirrored as
`OWNER_EMAIL` in `lib/businessInfo.ts`, with a test pinning the two together)
rather than left blank. Requiring a console step to switch on a summary nobody
has seen yet is how it stays switched off forever. `REPORT_TO_ADDRESS`
overrides it.

It still will not send without `ALERT_FROM_ADDRESS`: there is no verified
sender without one, and the handler refuses rather than trying. **And if SES is
still in sandbox mode, only verified addresses receive anything** — worth
checking before waiting a month for an email that never comes.

## 10. Guest Upload Promise — refund to the card, decided by a person

**Decided.** Shipped.

If a paid event got **no guest uploads at all**, the host gets their money back,
to the card they paid with. Claims open 7 days after the event and close at 21.

**Nothing in this codebase issues a refund.** A host files a claim, it lands in
an admin queue, a person refunds the card in Stripe, and then marks it recorded
here. `RECORDED` means "a human did this and told us", never "we did this".
There is deliberately no status meaning *paid out*, and the claim function has
no Stripe client. Tests assert both.

**A single ledger with a hard cap.** Every refund reason
(`GUEST_UPLOAD_PROMISE`, `SERVICE_FAILURE`, `GOODWILL`, `CANCELLATION`) writes
to one table, and the total that can go back is capped at what actually came in
— summed from the Payment rows, never from the tier price, because a repricing
must not change what an old event can get back. `APPROVED` counts against the
cap as well as `RECORDED`: money we have decided to return is committed, and
counting only what has been paid out would let a second claim be approved
against the same money.

**The unverifiable part, handled by asking.** SharePix cannot know whether a
printed QR sign was ever put out — an event with no uploads because the host
forgot the signs looks identical to one where guests ignored them. So the host
attests that they made the code available. It is a claim, not proof, and it is
worth having anyway: most people will not tick a box that says something untrue,
and the ones who would are cheaper to refund than to police. What it does not
justify is device fingerprinting to catch them.

**An event with no date cannot claim** — it is told to get in touch instead.
Timing a window off the wrong day would open and close it before some events
even happen, and telling a host "too late" about an event next week is worse
than telling them to write to us.

Refunds have accordingly moved off the monthly report's *not measured* list.
Chargebacks have not: no dispute data comes back from Stripe, and lumping the
two together would claim coverage we do not have.

## 11. Ratings and testimonials — and where the line is on reviews

**Every host who paid gets asked to rate their event, 1–5, a couple of days
after the upload window closes.** Not only the ones whose events succeeded: the
survey pass is limited to Successful Events because ten minutes of research from
a host with an empty gallery is both useless and unkind, but a one-tap rating is
not, and asking only the hosts it worked for would measure the failure rate
entirely from events where nothing failed.

**A 4 or 5 leads to a testimonial ask. A 1, 2 or 3 leads to support.** The
low branch opens a follow-up an admin has to close, and the dashboard says
plainly how many are still open. Nothing in the flow discourages a complaint,
delays it, or asks anyone to reconsider before sending it.

### The distinction the brief blurs

The growth-loop document asks for a "public review / testimonial request" sent
only to hosts who rated positively. Half of that is fine and half is not:

- A **testimonial** is advertising copy on sharepix.net. Asking happy customers
  for it is normal — nobody has ever believed a company's own page carries a
  representative sample of opinion, and nobody expects an unhappy customer to
  write an advert.
- A **public review** — Google, an app store, a directory — is an entry in a
  record that belongs to everyone. Soliciting those from satisfied customers
  only is *review gating*: the score becomes a filter on who is invited to
  speak, and the resulting public record is skewed by design. Every platform
  that hosts such reviews prohibits it, and the FTC's consumer-review rule
  treats manipulating the visible balance of reviews as deceptive.

So the first is built and the second is not. There is no field, status or link
anywhere in the flow for a third-party review, and a test scans the source to
keep it that way. **If SharePix ever wants Google reviews, the ask has to go to
every host regardless of score** — that is a different feature, not a setting.

### Permission is its own act

Writing a testimonial and letting SharePix publish it are two decisions. The
checkbox is never pre-ticked, only a literal `true` grants anything, and the
wording agreed to is stored with the grant so an old permission keeps meaning
what it said. The name is **anonymous unless the host types one** — a name
published because a default said so is not a name anyone agreed to publish.

Permission is checked at the moment of publishing rather than at the moment an
admin approved, so a withdrawal after approval takes effect. An admin cannot
approve a testimonial whose host did not consent: approving does not create
permission and the queue refuses rather than leaving a row that looks ready.

### Not built

No Featured Event invitation, no referral offer, no credit ledger, no repeat-use
message. Those are the rest of the growth loop and each needs a decision first —
referral amounts, whether credit exists at all — that has not been made.

## 12. Storage: measured, bounded, and reclaimed on delete

Groundwork for advertising unlimited photo uploads. **The pricing and copy have
not changed** — nothing here removes the 3,000-photo cap. This is what has to be
true before removing it is safe.

### The dangerous combination

Unlimited photos on its own is fine. Unlimited photos *while nothing deletes
bytes and nothing limits velocity* is not: one event could write unboundedly,
forever, for $79, and no query could tell you it had happened.

Three things were missing and all three are now present.

### Bytes are counted, server-side only

`sanitize-upload` is the only place in SharePix that knows an object's real
size — uploads go browser → S3 directly, so no application server sees the bytes
and anything the browser reported would be a claim. A counter the client could
set to zero is worse than no counter, because it reads as authoritative.

Counting is **idempotent**: S3 delivers at-least-once and a strippable original
arrives twice by design (once as uploaded, once as the sanitized rewrite). A
conditional put on a per-key ledger row is what gates the increment, so a
redelivery adds nothing. That row is also what lets deletion subtract exactly
what was added rather than guessing.

Counters are **Float, not Integer**. GraphQL's `Int` is 32-bit and tops out at
2.1 GB, which a single event with a few hundred videos passes — and the overflow
would be silent.

Photos, video and derived files (previews and thumbs, which *we* generate) are
counted separately, because folding them together would make an event's storage
read about a third larger than what anyone actually uploaded.

### A deleted photo is now actually deleted

`delete-event-photo` removed the S3 objects and the row but **never touched R2**,
which is where reads are served from — and `mediaUrls` signs a key without
consulting the photo table. So anyone already holding the key, meaning every
guest who had loaded the gallery, kept a working URL indefinitely. It also never
deleted the thumbnail at all, in either store.

Both are fixed. This mattered most on the moderation and DMCA paths, where
deletion *is* the remedy.

### Flagged, not throttled

`lib/fairUse.ts` holds every threshold, all environment-overridable, none copied
into a handler or a component.

**A threshold crossed makes an event visible, not blocked.** A large wedding
uploads exactly as freely as a small one; a person is simply told about it. Only
the abuse thresholds block, and they sit far above any real event — 50,000
photos, 500 GB, 1,200 uploads a minute. Throttling a paying customer whose event
went well is a far more expensive mistake than letting an abusive event run
another hour before someone looks.

An admin's judgement beats the thresholds **in both directions**: `NORMAL`
clears an event they have looked at, `RESTRICTED` stops one the numbers did not
catch.

The numbers are hypotheses with stated reasons, not tuning — there is no real
data yet, and that is the honest state to ship in.

### Not done

Nothing reclaims storage from *expired* events yet. The S3 backstop rule expires
`events/` after 800 days and that is all. Bounded retention is what would make
unlimited photos bounded in cost, and it is the open half of this.

## 13. The report recipient is a setting, not a line of code

`seth@sharepix.net` was defaulted into `amplify/backend.ts`. It now lives in the
`AppSetting` table and a global admin edits it on the dashboard.

An address compiled into application code needs a code change, a review and a
deploy to move, which is how it ends up wrong and stays wrong — and it puts a
named person's inbox in the repository.

The consequence is that **the report sends to nobody until an admin sets it**.
That is the correct trade: a report going nowhere is visible on the settings
screen, where a report going to the wrong inbox is visible nowhere. The
`REPORT_TO_ADDRESS` env var survives as a fallback for a deployment that wants
to pin one.

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
