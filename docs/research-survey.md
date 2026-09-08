# Post-event research survey

The question set behind `NEXT_PUBLIC_RESEARCH_SURVEY_URL`.

## Why this file exists

The survey lives in a form provider, so nothing in this repository could stop it
describing a product we no longer sell. It drifted: the questions asked about a
90-day gallery, implied a $49 price, and implied a photo cap. All three were
true once. None of them is now, and a respondent answering "was that fair?"
about a price they did not pay is not data, it is noise that looks like data.

This file is the source of truth for the wording. `__tests__/research-survey.test.ts`
checks the product facts stated here against `lib/pricing.ts` and
`lib/researchIncentive.ts`, so the next reprice fails a test instead of
quietly invalidating a month of responses.

**Editing the form is a manual step.** The test proves this file agrees with the
code; it cannot prove the form agrees with this file. When this file changes,
update the form.

## What was wrong, and what it cost

| Old wording | Reality today | Why it mattered |
|---|---|---|
| "your gallery stays up for 90 days" | 12-month gallery, then a 90-day archive, then deletion | Retention is one of the top reasons people buy. Understating it by a factor of four biases every answer about value. |
| Implied $49 | $79 one-time | Willingness-to-pay answers anchored to a price nobody was charged. |
| Implied a photo cap | Unlimited photos under fair use | Asked people to react to a constraint that no longer exists. |
| No free tier | One free event per account | A free-trial host and a paying host answering the same price question are two different measurements. |

## Product facts as of this file

Stated plainly so the form's preamble can be copied from here, and so the test
has something concrete to check.

- The paid plan is **Full Event**, **$79**, one-time. No subscription.
- It includes **unlimited photos** under fair use, and **30 videos** (up to
  250 MB each). Video is capped because it is served at full size on every play.
- **60-day upload window**, extendable in 30-day blocks for half the plan price.
- After the window closes the gallery stays up **12 months** — guests at reduced
  resolution, the host at full access with downloads.
- Then a **90-day private archive**, then permanent deletion of the whole event:
  photos, comments, likes, guest book entries and moments.
- A **free event** is one per account: 50 photos, 1 video, 30-day gallery.
- Guests need **no app and no account** to upload or download.
- The research incentive is a **$25 Amazon gift card**, sent by hand.

## Rules the questions follow

Three, and they are not stylistic.

1. **The gift card does not depend on the answers.** Not on a rating, not on a
   recommendation, not on permission to use photos. This is stated on the
   landing page and must be stated in the form. If it were conditional we would
   be paying for agreement.
2. **No question routes a respondent by sentiment.** Asking happy people for a
   public review and unhappy people for a support ticket is review gating. The
   testimonial flow (`lib/customerRating.ts`) is a separate, consented thing;
   the research survey never feeds it.
3. **Ask what happened, not what they would have done.** "How many guests
   uploaded?" beats "would you have paid more?" — the first is recall, the
   second is invention.

## Screening

**S1. Which did you run?** *(single choice — routes the price section)*
- A free event
- A paid event ($79)
- I am not sure

A free-event respondent skips Q14–Q16. Their price answers measure intent, not
experience, and mixing the two silently is how a willingness-to-pay number ends
up meaning nothing.

## The event itself

**Q1.** What was the occasion? *(wedding / birthday / anniversary / memorial /
corporate or work event / reunion / other — free text)*

**Q2.** Roughly how many people were there? *(under 25 / 25–50 / 51–100 /
101–200 / over 200)*

**Q3.** How did guests find out they could upload? *(select all — printed QR
sign / QR on a table card / someone told them / a link you sent / other)*

**Q4.** Roughly what share of your guests uploaded something? *(almost none /
a few / about a quarter / about half / most of them / I do not know)*

**Q5.** Was anyone unable to upload? What happened? *(free text, optional)*

This is the one question most likely to surface a real defect, so it is early,
open, and not preceded by anything that implies uploads went well.

## Before the event

**Q6.** What were you using to collect photos before you found SharePix?
*(select all — a group chat / a shared cloud album / a hashtag / a
disposable-camera setup / another photo-sharing service / nothing)*

**Q7.** If you looked at other services, which ones, and what made you choose or
reject them? *(free text, optional)*

**Q8.** What nearly stopped you from signing up? *(free text, optional)*

## Using it

**Q9.** How much of a hassle was setting up your event? *(1 = trivial,
5 = a real chore)*

**Q10.** Did you use any of these? *(select all — moderation / guest book /
live slideshow / custom QR code / gallery fonts and layout / likes and comments
/ downloads / none of them)*

**Q11.** Was anything missing that you expected to be there? *(free text)*

**Q12.** Did anything go wrong? *(free text)*

**Q13.** How long do you think your gallery stays available after uploads close?
*(under a month / a few months / about a year / longer / I do not know)*

Q13 is a comprehension check, not a satisfaction question. If paying hosts
cannot state the retention they bought, the pricing page is failing regardless
of what the retention actually is.

## Price — paid respondents only

**Q14.** $79 for your event was: *(far too much / a bit much / about right / a
bit cheap / far too cheap)*

**Q15.** What did you compare it to when you decided? *(free text)*

**Q16.** Since the event, has it turned out to be worth it? *(clearly not /
not really / about what I expected / more than I expected)*

Q14 and Q16 are deliberately separate. The price felt at checkout and the value
felt afterwards are different numbers, and averaging them hides the gap that
matters most.

## Free-event respondents only

**Q17.** After running your free event, would you pay $79 for the paid plan at
your next one? *(definitely not / probably not / maybe / probably / definitely)*

**Q18.** What would have to be true for that to be a yes? *(free text)*

## Close

**Q19.** Would you use SharePix again? *(yes / no / not sure)* — with an
optional free text.

**Q20.** Anything else? *(free text)*

Q19 stays a plain question with no routing on it. Whatever the answer, the next
screen is the same thank-you and the same gift card.

## Not asked, on purpose

- **Net Promoter Score.** A 0–10 recommendation score on this sample size is a
  number with no signal in it, and it invites the review-gating pattern rule 2
  exists to prevent.
- **Permission to use answers as marketing copy.** Consent for a testimonial is
  collected separately, tied to a rating, with its own consent version
  (`lib/customerRating.ts`). Folding it in here would make the gift card look
  conditional on saying something nice.
- **Anything about individual guests.** We do not identify them and should not
  start by asking the host to.
