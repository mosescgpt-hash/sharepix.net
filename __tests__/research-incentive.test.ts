import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INCENTIVE_AMOUNT_USD,
  INCENTIVE_STATUSES,
  INCENTIVE_TYPE,
  canTransition,
  completionMessage,
  eligibilityFor,
  incentiveId,
  isTerminal,
  requiresHumanFulfilment,
  type IncentiveStatus,
} from '../lib/researchIncentive';
import { decodeSurveyLink, encodeSurveyLink } from '../lib/surveyLink';
import { codeOnly } from './sourceGuards';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();

describe('the copies have not drifted', () => {
  it.each([
    'amplify/functions/daily-tasks/researchIncentive.ts',
    'amplify/functions/complete-survey/researchIncentive.ts',
  ])('keeps %s byte-identical to lib/researchIncentive.ts', (path) => {
    expect(bodyOf(read(path))).toBe(bodyOf(read('lib/researchIncentive.ts')));
  });

  it.each([
    'amplify/functions/daily-tasks/surveyLink.ts',
    'amplify/functions/complete-survey/surveyLink.ts',
  ])('keeps %s byte-identical to lib/surveyLink.ts', (path) => {
    expect(bodyOf(read(path))).toBe(bodyOf(read('lib/surveyLink.ts')));
  });

  it('keeps the daily job agreeing about what a Successful Event is', () => {
    expect(bodyOf(read('amplify/functions/daily-tasks/successfulEvent.ts'))).toBe(
      bodyOf(read('lib/successfulEvent.ts')),
    );
  });
});

describe('the reward', () => {
  it('is $25, manual, and named so a second kind is a visible change', () => {
    expect(INCENTIVE_AMOUNT_USD).toBe(25);
    expect(INCENTIVE_TYPE).toBe('AMAZON_GIFT_CARD_MANUAL');
  });

  it('always needs a person to fulfil it', () => {
    expect(requiresHumanFulfilment()).toBe(true);
  });
});

describe('eligibility never depends on what the feedback said', () => {
  it('takes no sentiment as input at all', () => {
    // Part 14 of the brief, expressed as a type signature rather than a
    // promise: the information needed to discriminate on a rating, a
    // recommendation or a testimonial is not in scope, so it cannot be used by
    // accident. Research paid for on condition of approval buys agreement and
    // then reports it as evidence.
    const source = read('lib/researchIncentive.ts');
    const fn = source.slice(source.indexOf('export interface EligibilityInput'));
    const input = fn.slice(0, fn.indexOf('}'));
    for (const forbidden of [
      'rating',
      'score',
      'satisfaction',
      'recommend',
      'nps',
      'testimonial',
      'positive',
      'sentiment',
      'photoPermission',
    ]) {
      expect(input.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('pays for a completed survey regardless of the answers', () => {
    const done = {
      surveyCompleted: true,
      enrolled: true,
      participantEmail: 'host@example.com',
    };
    expect(eligibilityFor(done).eligible).toBe(true);
  });

  it('refuses only for reasons that have nothing to do with content', () => {
    expect(
      eligibilityFor({ surveyCompleted: false, enrolled: true, participantEmail: 'a@b.com' })
        .eligible,
    ).toBe(false);
    expect(
      eligibilityFor({ surveyCompleted: true, enrolled: false, participantEmail: 'a@b.com' })
        .eligible,
    ).toBe(false);
    expect(
      eligibilityFor({ surveyCompleted: true, enrolled: true, participantEmail: '  ' }).eligible,
    ).toBe(false);
  });

  it('says why, so the admin queue is readable', () => {
    const refused = eligibilityFor({
      surveyCompleted: true,
      enrolled: true,
      participantEmail: '',
    });
    expect(refused.reason).toMatch(/email/i);
  });
});

describe('the status machine', () => {
  it('has exactly the seven states the brief names', () => {
    expect([...INCENTIVE_STATUSES]).toEqual([
      'PENDING',
      'ELIGIBLE',
      'AWAITING_MANUAL_FULFILLMENT',
      'FULFILLED',
      'FAILED',
      'CANCELED',
      'DISQUALIFIED',
    ]);
  });

  it('only ever reaches FULFILLED from the queue a person works', () => {
    // The expensive mistake here is a path into FULFILLED nobody meant to
    // create: a gift card recorded as sent that nobody sent, or sent twice.
    const into = INCENTIVE_STATUSES.filter((from) => canTransition(from, 'FULFILLED'));
    expect(into).toEqual(['AWAITING_MANUAL_FULFILLMENT']);
  });

  it('lets a survey completion move an invitation into the queue', () => {
    expect(canTransition('PENDING', 'AWAITING_MANUAL_FULFILLMENT')).toBe(false);
    expect(canTransition('ELIGIBLE', 'AWAITING_MANUAL_FULFILLMENT')).toBe(true);
    // A failed send can be retried by hand.
    expect(canTransition('FAILED', 'AWAITING_MANUAL_FULFILLMENT')).toBe(true);
  });

  it('never moves out of a terminal state', () => {
    for (const status of ['FULFILLED', 'CANCELED', 'DISQUALIFIED'] as IncentiveStatus[]) {
      expect(isTerminal(status)).toBe(true);
      for (const to of INCENTIVE_STATUSES) {
        expect(canTransition(status, to)).toBe(false);
      }
    }
  });

  it('can always be cancelled before it is settled', () => {
    for (const status of [
      'PENDING',
      'ELIGIBLE',
      'AWAITING_MANUAL_FULFILLMENT',
      'FAILED',
    ] as IncentiveStatus[]) {
      expect(canTransition(status, 'CANCELED')).toBe(true);
    }
  });
});

describe('one obligation per piece of research', () => {
  it('keys on the event and the survey', () => {
    // A double submission, a job retry or a reloaded thank-you page must not
    // create two gift-card obligations from one survey.
    expect(incentiveId('evt-1', 'post-event-v1')).toBe('evt-1#post-event-v1');
    expect(incentiveId('evt-1', 'post-event-v1')).not.toBe(incentiveId('evt-2', 'post-event-v1'));
    // A second survey is a second programme, and earns separately.
    expect(incentiveId('evt-1', 'post-event-v1')).not.toBe(incentiveId('evt-1', 'follow-up-v1'));
  });
});

describe('what the customer is told', () => {
  it('does not say the card has been sent, because it has not', () => {
    // Promising delivery we have not made is how a goodwill programme becomes
    // a complaint.
    const message = completionMessage();
    expect(message).toMatch(/we'll send it/i);
    expect(message).not.toMatch(/has been sent|already sent|on its way/i);
  });

  it('names the amount', () => {
    expect(completionMessage(25)).toContain('$25');
  });

  it('promises a delivery time only when one is configured', () => {
    expect(completionMessage(25)).not.toMatch(/\d+\s*[-–]\s*\d+ business days/i);
    expect(completionMessage(25, '3–5 business days')).toContain('3–5 business days');
  });
});

describe('the survey link', () => {
  const parts = { eventId: 'evt-1', surveyId: 'post-event-v1', token: 'abc123' };

  it('round-trips', () => {
    expect(decodeSurveyLink(encodeSurveyLink(parts))).toEqual(parts);
  });

  it('is url-safe and unpadded, so an email client leaves it alone', () => {
    const encoded = encodeSurveyLink({ ...parts, eventId: 'a'.repeat(40) });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('does not show the event id to someone reading the link', () => {
    expect(encodeSurveyLink(parts)).not.toContain('evt-1');
  });

  it('refuses anything malformed rather than guessing', () => {
    // The caller must treat null exactly as it treats a wrong token, so this
    // never becomes a way to discover which event ids are real.
    for (const bad of ['', '   ', 'not-base64!!', null, undefined]) {
      expect(decodeSurveyLink(bad)).toBeNull();
    }
    // Right encoding, wrong shape.
    expect(decodeSurveyLink(Buffer.from('only|two').toString('base64url'))).toBeNull();
    expect(decodeSurveyLink(Buffer.from('a|b|').toString('base64url'))).toBeNull();
  });

  it('bounds every part, since they become a key and a comparison', () => {
    const huge = Buffer.from(`${'x'.repeat(200)}|s|t`).toString('base64url');
    expect(decodeSurveyLink(huge)).toBeNull();
  });
});

describe('the completion endpoint', () => {
  const handler = read('amplify/functions/complete-survey/handler.ts');

  it('checks the token in constant time before changing anything', () => {
    expect(handler).toContain('timingSafeEqual');
    expect(handler).toContain("tokensMatch(row.surveyToken?.S ?? '', parts.token)");
  });

  it('gives one answer for a bad link, a wrong token and an unknown event', () => {
    const throws = handler.match(/throw new Error\(([^)]*)\)/g) ?? [];
    expect(throws.length).toBeGreaterThan(0);
    for (const line of throws) expect(line).toContain('REFUSED');
  });

  it('cannot write FULFILLED', () => {
    // The whole point. A visitor with a link creates an obligation; a person
    // in the admin queue discharges it. Scoped to the write, because the
    // handler legitimately READS the status to recognise an already-recorded
    // completion — it is what it can SET that matters.
    const write = handler.slice(
      handler.indexOf('new UpdateItemCommand'),
      handler.lastIndexOf('return {'),
    );
    expect(write).toContain("':next': { S: 'AWAITING_MANUAL_FULFILLMENT' }");
    expect(write).not.toContain('FULFILLED,');
    expect(write).not.toContain("S: 'FULFILLED'");
    expect(write).not.toContain('fulfilledAt');
    expect(write).not.toContain('fulfilledBy');
  });

  it('applies its one transition conditionally on the status it read', () => {
    // Two submissions racing cannot both apply it, and a status a person
    // changed in between wins over what this saw.
    expect(handler).toContain("ConditionExpression: '#status = :seen'");
  });

  it('treats an already-recorded completion as success, not an error', () => {
    // Someone reloading the page must see the same calm confirmation rather
    // than a failure for something that already worked.
    expect(handler).toContain("status === 'AWAITING_MANUAL_FULFILLMENT' || status === 'FULFILLED'");
  });
});

describe('the gift-card programme, now that the survey is in the product', () => {
  const job = read('amplify/functions/daily-tasks/handler.ts');

  /**
   * The invitation this file used to describe sent people to a form provider
   * and opened a $25 obligation at the same time. The survey is now part of
   * SharePix, the invitation email promises no gift card, and nothing opens a
   * new obligation. What is asserted here is that the pause is clean: existing
   * promises are kept, and no new ones are made by accident.
   */

  it('offers a reward only where an admin chose to', () => {
    // Not a rule the job applies: a decision a person makes with the event in
    // front of them. Off unless set, so a comped event is not paid for twice.
    const code = codeOnly(job);
    expect(code).toContain('const offersReward = event.researchIncentiveOffered;');
    expect(code).toContain('async function openIncentiveObligation');
  });

  it('never promises a reward it has not recorded', () => {
    // The email line and the obligation come from the same flag, and the
    // obligation is written first — an invitation whose obligation failed is
    // skipped and retried rather than sent.
    const code = codeOnly(job);
    expect(code).toContain(
      'if (offersReward && !(await openIncentiveObligation(event, nowISO))) continue;',
    );
    expect(code).toContain('const rewardLine = offersReward');
  });

  it('keeps the promise already made to everyone invited', () => {
    // Their link carries the ResearchIncentive token, so the survey row they
    // land on has to carry the same one or the link says it is invalid.
    const fn = job.slice(job.indexOf('async function backfillResearchInvites'));
    expect(fn.slice(0, 2600)).toContain("(item.status?.S ?? '') !== 'PENDING'");
    expect(fn.slice(0, 2600)).toContain('surveyToken: { S: token }');
    expect(fn.slice(0, 2600)).toContain("ConditionExpression: 'attribute_not_exists(id)'");
  });

  it('leaves the fulfilment rules and the admin queue alone', () => {
    // Paused, not retired: the statuses, the transitions and the amount are
    // unchanged, and the rows already owed are still worked from the dashboard.
    expect(INCENTIVE_AMOUNT_USD).toBe(25);
    expect(read('lib/researchIncentive.ts')).toContain('INCENTIVE_STATUSES');
  });

  it('still treats the survey invitation as optional mail', () => {
    // We are asking for something for ourselves, so an opt-out is absolute.
    expect(job).toContain("mayReceive(event.alertEmail, 'research-survey', preference)");
  });
});
