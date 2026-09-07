import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMMITTED_STATUSES,
  REFUND_REASONS,
  REFUND_STATUSES,
  canTransition,
  committedCents,
  formatCents,
  refundDecision,
  refundId,
  remainingRefundableCents,
  type RefundStatus,
} from '../lib/refunds';
import {
  ATTESTATION_QUESTION,
  CLAIM_CLOSES_DAYS_AFTER,
  CLAIM_OPENS_DAYS_AFTER,
  canFileClaim,
  promiseEligibility,
} from '../lib/guestUploadPromise';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();

const EVENT_DAY = '2026-09-01';
const at = (daysAfter: number) =>
  new Date(Date.parse(`${EVENT_DAY}T00:00:00.000Z`) + daysAfter * 24 * 60 * 60 * 1000);
/** A paid event nobody uploaded to. */
const abandoned = { tier: 'plus', paid: true, guestUploadCount: 0, date: EVENT_DAY };

describe('the copies have not drifted', () => {
  it.each(['refunds', 'guestUploadPromise'])('keeps the Lambda copy of %s identical', (name) => {
    expect(bodyOf(read(`amplify/functions/claim-refund/${name}.ts`))).toBe(
      bodyOf(read(`lib/${name}.ts`)),
    );
  });
});

describe('nothing in this codebase issues a refund', () => {
  // The single most important property here. A person refunds the card in
  // Stripe and records it; RECORDED means "a human did this and told us".
  const sources = [
    'lib/refunds.ts',
    'lib/api.ts',
    'amplify/functions/claim-refund/handler.ts',
    'pages/global-admin.tsx',
    'pages/event/[eventId]/admin.tsx',
  ];

  it.each(sources)('%s never calls a refund API', (path) => {
    const source = read(path);
    expect(source).not.toMatch(/refunds\.create/i);
    expect(source).not.toMatch(/stripe\.refunds/i);
    expect(source).not.toMatch(/createRefund\(/);
  });

  it('does not give the claim function a Stripe client', () => {
    const handler = read('amplify/functions/claim-refund/handler.ts');
    expect(handler).not.toContain('stripe');
    expect(handler).not.toContain('STRIPE_SECRET');
  });

  it('has no status meaning "we paid it out"', () => {
    // RECORDED is the terminal success state and it means somebody told us.
    expect([...REFUND_STATUSES]).toEqual(['REQUESTED', 'APPROVED', 'RECORDED', 'DECLINED']);
    expect(REFUND_STATUSES).not.toContain('PAID');
    expect(REFUND_STATUSES).not.toContain('ISSUED');
  });
});

describe('the stacking cap', () => {
  it('counts approved as well as recorded', () => {
    // An approved refund is money already decided. Counting only what has been
    // paid out would let a second claim be approved against the same money in
    // the gap between deciding and doing.
    expect([...COMMITTED_STATUSES].sort()).toEqual(['APPROVED', 'RECORDED']);
    expect(
      committedCents([
        { status: 'APPROVED', amountCents: 2000 },
        { status: 'RECORDED', amountCents: 1000 },
        { status: 'REQUESTED', amountCents: 5000 },
        { status: 'DECLINED', amountCents: 5000 },
      ]),
    ).toBe(3000);
  });

  it('never lets total refunds exceed what was paid', () => {
    // Negative revenue through stacked refunds is the specific outcome being
    // engineered against.
    const ledger = [{ status: 'RECORDED', amountCents: 5000 }];
    expect(remainingRefundableCents(7900, ledger)).toBe(2900);
    const decision = refundDecision(7900, 7900, ledger);
    expect(decision.allowed).toBe(true);
    expect(decision.amountCents).toBe(2900);
  });

  it('reduces an oversized request rather than refusing it', () => {
    // The person filing wants the customer made whole; the cap decides how
    // whole that can be.
    expect(refundDecision(99999, 7900, []).amountCents).toBe(7900);
  });

  it('refuses once everything has gone back', () => {
    const ledger = [{ status: 'RECORDED', amountCents: 7900 }];
    expect(remainingRefundableCents(7900, ledger)).toBe(0);
    const decision = refundDecision(7900, 7900, ledger);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/already been refunded/i);
  });

  it('refuses when nothing was ever paid', () => {
    const decision = refundDecision(7900, 0, []);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/nothing was paid/i);
  });

  it('never goes negative on a corrupt ledger', () => {
    expect(remainingRefundableCents(-100, [])).toBe(0);
    expect(remainingRefundableCents(1000, [{ status: 'RECORDED', amountCents: -500 }])).toBe(1000);
  });

  it('gives one claim per event per reason', () => {
    expect(refundId('evt-1', 'GUEST_UPLOAD_PROMISE')).toBe('evt-1#GUEST_UPLOAD_PROMISE');
    // Different reasons stack; the cap is what bounds the total.
    expect(refundId('evt-1', 'GUEST_UPLOAD_PROMISE')).not.toBe(refundId('evt-1', 'GOODWILL'));
  });

  it('names every reason money goes back', () => {
    expect([...REFUND_REASONS]).toEqual([
      'GUEST_UPLOAD_PROMISE',
      'SERVICE_FAILURE',
      'GOODWILL',
      'CANCELLATION',
    ]);
  });
});

describe('the status machine', () => {
  it('can only reach RECORDED from APPROVED', () => {
    const into = REFUND_STATUSES.filter((from) => canTransition(from, 'RECORDED'));
    expect(into).toEqual(['APPROVED']);
  });

  it('lets an approved refund still be declined', () => {
    // Approving is a decision and issuing is an act. The gap between them is
    // where somebody notices a mistake.
    expect(canTransition('APPROVED', 'DECLINED')).toBe(true);
  });

  it('never moves out of a settled state', () => {
    for (const status of ['RECORDED', 'DECLINED'] as RefundStatus[]) {
      for (const to of REFUND_STATUSES) expect(canTransition(status, to)).toBe(false);
    }
  });
});

describe('who can claim the Guest Upload Promise', () => {
  it('applies to a paid event nobody uploaded to, inside the window', () => {
    expect(promiseEligibility(abandoned, at(10)).eligible).toBe(true);
  });

  it('does not apply once a single guest has uploaded', () => {
    expect(
      promiseEligibility({ ...abandoned, guestUploadCount: 1 }, at(10)).blocker,
    ).toBe('guests-did-upload');
  });

  it('does not apply to a free event, and says so kindly', () => {
    // The host has not lost anything. The answer is not "you are ineligible"
    // but "there is no money involved".
    const result = promiseEligibility({ ...abandoned, tier: 'free' }, at(10));
    expect(result.blocker).toBe('free-tier');
    expect(result.message).toMatch(/nothing to refund/i);
  });

  it('does not apply to an event that was never paid for', () => {
    expect(promiseEligibility({ ...abandoned, paid: false }, at(10)).blocker).toBe('not-paid');
  });

  it('opens a week after the event, not immediately', () => {
    // A guest uploading three days late is common, and would turn a valid
    // claim into a wrong one.
    expect(CLAIM_OPENS_DAYS_AFTER).toBe(7);
    expect(promiseEligibility(abandoned, at(3)).blocker).toBe('too-early');
    expect(promiseEligibility(abandoned, at(CLAIM_OPENS_DAYS_AFTER)).eligible).toBe(true);
  });

  it('closes three weeks after, and says where to go instead', () => {
    expect(CLAIM_CLOSES_DAYS_AFTER).toBe(21);
    const late = promiseEligibility(abandoned, at(CLAIM_CLOSES_DAYS_AFTER));
    expect(late.blocker).toBe('too-late');
    expect(late.message).toMatch(/get in touch/i);
  });

  it('refuses rather than guessing when the event has no date', () => {
    // A window timed off the wrong day would open and close before some events
    // even happen. Telling a host "too late" about an event next week is worse
    // than telling them to get in touch.
    const result = promiseEligibility({ ...abandoned, date: null }, at(10));
    expect(result.blocker).toBe('no-event-date');
    expect(result.message).toMatch(/get in touch/i);
  });

  it('tells the host when the window opens, so "too early" is actionable', () => {
    const early = promiseEligibility(abandoned, at(3));
    expect(early.opensAt?.toISOString().slice(0, 10)).toBe('2026-09-08');
  });
});

describe('the attestation', () => {
  it('is required, and is a question about the host putting the code out', () => {
    // SharePix cannot know whether a printed sign was displayed. Asking is the
    // honest answer; device fingerprinting to police it is not.
    expect(ATTESTATION_QUESTION).toMatch(/QR code or event link available/i);
    expect(canFileClaim(abandoned, false, at(10)).ok).toBe(false);
    expect(canFileClaim(abandoned, true, at(10)).ok).toBe(true);
  });

  it('reports a missing attestation differently from being ineligible', () => {
    // "Not yet, claims open on the 8th" and "please confirm you put the code
    // out" are different conversations.
    expect(canFileClaim(abandoned, false, at(10)).message).toMatch(/confirm you made/i);
    expect(canFileClaim(abandoned, true, at(3)).message).toMatch(/claims open/i);
  });
});

describe('the claim function trusts nothing from the caller', () => {
  const handler = read('amplify/functions/claim-refund/handler.ts');

  it('re-derives every eligibility fact from the stored row', () => {
    expect(handler).toContain('tier: row.tier?.S ?? null');
    expect(handler).toContain('paid: row.paid?.BOOL !== false');
    expect(handler).toContain("guestUploadCount: Number(row.guestUploadCount?.N ?? '0')");
    expect(handler).toContain('date: row.date?.S ?? null');
  });

  it('never takes an amount from the request', () => {
    // A browser that could name its own amount would be a browser that could
    // refund itself anything.
    expect(handler).not.toMatch(/arguments\.amount/);
    expect(handler).toContain('const paidCents = await paidCentsFor(eventId)');
  });

  it('sums what was actually paid rather than the tier price', () => {
    // The tier price is what the plan costs today. A repricing must not change
    // what an old event can get back.
    expect(handler).toContain('amountTotal');
    const fn = handler.slice(handler.indexOf('async function paidCentsFor'));
    expect(fn.slice(0, 1600)).not.toContain('getTier');
  });

  it('ignores payments that never completed', () => {
    // Refunding against a pending or failed session returns cash never taken.
    const fn = handler.slice(handler.indexOf('async function paidCentsFor'));
    expect(fn.slice(0, 1600)).toContain("status !== 'complete'");
  });

  it('gives the same answer for a missing event and someone else’s', () => {
    expect(handler).toContain('// Deliberately the same answer for "no such event" and "not yours"');
    expect(handler).toContain('!owner.includes(sub)');
  });

  it('is idempotent, so a second claim is the same claim', () => {
    expect(handler).toContain("ConditionExpression: 'attribute_not_exists(id)'");
    expect(handler).toContain('You have already made a claim');
  });
});

describe('what the host is shown', () => {
  const dashboard = read('pages/event/[eventId]/admin.tsx');

  it('offers the claim only when it applies', () => {
    // Offering a refund to a host whose event worked is a strange thing to put
    // on their dashboard.
    expect(dashboard).toContain('{promise.eligible ? (');
  });

  it('says the money goes back to the card they paid with', () => {
    expect(dashboard).toMatch(/back to the card\s*\n?\s*you paid with/i);
  });

  it('requires the attestation before the button works', () => {
    expect(dashboard).toContain('disabled={!attested || claiming}');
  });
});

describe('formatting', () => {
  it('shows cents as dollars', () => {
    expect(formatCents(7900)).toBe('$79.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(-100)).toBe('$0.00');
  });
});
