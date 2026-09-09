import { bodyOf, codeOnly, readSource } from './sourceGuards';

/**
 * How the daily job decides who is asked, and how it is stopped from asking
 * twice.
 *
 * The handler is a Lambda that talks to DynamoDB, so these read its source
 * rather than run it — the timing and reminder rules it depends on are pure and
 * tested directly in survey.test.ts. What is asserted here is that the job uses
 * those rules, and that every "only once" is a condition on a write rather than
 * a decision the job remembers.
 */

const raw = readSource('amplify/functions/daily-tasks/handler.ts');
const handler = codeOnly(raw);

/**
 * One pass of the job, as code.
 *
 * Sliced from the raw source because the section markers are comments, then
 * stripped — searching comment-free source for a comment finds nothing, which
 * is a way to write a guard that passes by being unable to look.
 */
function pass(from: string, to: string): string {
  const start = raw.indexOf(from);
  const end = raw.indexOf(to);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return codeOnly(raw.slice(start, end));
}

describe('the Lambda copy of the survey rules', () => {
  it('is byte-identical to lib/survey.ts below the header', () => {
    expect(bodyOf(readSource('amplify/functions/daily-tasks/survey.ts'))).toBe(
      bodyOf(readSource('lib/survey.ts')),
    );
  });
});

describe('when the invitation goes out', () => {
  it('uses the shared timing rule rather than its own arithmetic', () => {
    expect(handler).toContain('surveyIsDue(event, now)');
  });

  it('no longer measures the survey from the upload window', () => {
    // uploadWindowEndsAt is sixty days after the event was created and has
    // nothing to do with when the event happened. Measuring from it put the
    // invitation two months late.
    const invitePass = pass('Post-event survey invitations', 'Rating requests.');
    expect(invitePass).not.toContain('uploadWindowEndsAt');
    expect(handler).not.toContain('SURVEY_DELAY_DAYS');
  });

  it('has no external form URL left to point at', () => {
    // The survey is a page in this application now, so there is no
    // configuration that can be wrong in a way that mails a link to nowhere.
    expect(handler).not.toContain('RESEARCH_SURVEY_URL');
    expect(handler).not.toContain('SURVEY_URL');
  });
});

describe('who is asked', () => {
  it('invites paid hosts and comped research cohorts, not free trials', () => {
    expect(handler).toContain('if (!event.paid && !founding) continue;');
  });

  it('spares an ordinary host whose event did not work', () => {
    // Asking someone whose event nobody came to how the product went is unkind,
    // and it is not what they bought.
    expect(handler).toContain('if (!founding && !isSuccessfulEvent(event)) continue;');
  });

  it('still asks a research cohort whose event did not work', () => {
    // They agreed to be asked, and a failed event is the most informative case
    // there is — which is the whole reason the cohort exists.
    const gate = handler.indexOf('if (!founding && !isSuccessfulEvent(event)) continue;');
    expect(gate).toBeGreaterThan(-1);
    expect(handler.slice(gate, gate + 120)).not.toContain('founding &&  isSuccessful');
  });

  it('treats an opt-out as absolute', () => {
    // We are asking for something for ourselves, so this is optional mail.
    expect(handler).toContain("mayReceive(event.alertEmail, 'research-survey', preference)");
  });
});

describe('sending it only once', () => {
  it('opens the row with a conditional put, so a retry cannot invite twice', () => {
    const opener = handler.slice(handler.indexOf('async function openSurveyInvite'));
    expect(opener.slice(0, 1600)).toContain("ConditionExpression: 'attribute_not_exists(id)'");
  });

  it('mints the token before anybody answers', () => {
    // A row that appeared because somebody guessed an id would be a row with no
    // proof anyone was ever sent it.
    const opener = handler.slice(handler.indexOf('async function openSurveyInvite'));
    expect(opener.slice(0, 1600)).toContain('randomBytes(24)');
  });

  it('claims the one reminder with a condition, not with a remembered flag', () => {
    const claim = handler.slice(handler.indexOf('async function claimSurveyReminder'));
    expect(claim.slice(0, 1200)).toContain('attribute_not_exists(reminderSentAt)');
    // And never reminds somebody who has already answered.
    expect(claim.slice(0, 1200)).toContain('attribute_not_exists(completedAt)');
  });

  it('asks the shared rule whether a reminder is due at all', () => {
    expect(handler).toContain('reminderIsDue(existing, now)');
  });

  it('records nothing as sent while sending is switched off', () => {
    // Otherwise switching it on later would skip the messages that were due as
    // though they had already gone.
    const invitePass = pass('Post-event survey invitations', 'Rating requests.');
    const dryRun = invitePass.indexOf('if (!SENDING_ENABLED)');
    const claim = invitePass.indexOf('claimSurveyReminder(event.id, nowISO)');
    expect(dryRun).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(dryRun);
  });
});

describe('not asking the same thing twice', () => {
  it('skips the rating request when the survey is already in', () => {
    // The survey asks how satisfied they are and whether we may quote them. A
    // rating request weeks later asks both again, and two permission records
    // that can disagree is worse than none.
    expect(handler).toContain('if (surveys.get(event.id)?.completedAt) continue;');
  });

  it('makes that check before the rating request is opened', () => {
    const ratingPass = codeOnly(raw.slice(raw.indexOf('Rating requests.')));
    const suppression = ratingPass.indexOf('surveys.get(event.id)?.completedAt');
    const opened = ratingPass.indexOf('openRatingRequest(event, nowISO)');
    expect(suppression).toBeGreaterThan(-1);
    expect(opened).toBeGreaterThan(suppression);
  });
});

describe('the outstanding gift-card invitations', () => {
  const backfill = handler.slice(handler.indexOf('async function backfillResearchInvites'));

  it('gives a link already in somebody’s inbox a row to land on', () => {
    // Those people were promised twenty-five dollars. Their link carries the
    // ResearchIncentive token, so the survey row has to carry the same one.
    expect(backfill.slice(0, 2600)).toContain('surveyToken: { S: token }');
    expect(backfill.slice(0, 2600)).toContain("(item.status?.S ?? '') !== 'PENDING'");
  });

  it('never disturbs a row the invitation flow already made', () => {
    expect(backfill.slice(0, 2600)).toContain("ConditionExpression: 'attribute_not_exists(id)'");
  });

  it('runs before the job decides who still needs inviting', () => {
    expect(handler.indexOf('await backfillResearchInvites(nowISO)')).toBeLessThan(
      handler.indexOf('const surveys = SURVEY_TABLE'),
    );
  });

  it('creates no new gift-card obligations', () => {
    // The current invitation email promises no gift card, so nothing may quietly
    // record that one is owed.
    expect(handler).not.toContain('openResearchInvite');
    expect(handler).not.toContain('INCENTIVE_AMOUNT_USD');
    expect(handler).not.toContain("status: { S: 'PENDING' }");
  });
});

describe('the invitation email', () => {
  const source = readSource('amplify/functions/daily-tasks/handler.ts');

  it('asks for the honest version rather than the good stuff', () => {
    expect(source).toContain('not just the good stuff');
  });

  it('promises no gift card, since none is opened', () => {
    const invitePass = source.slice(
      source.indexOf('---- the invitation'),
      source.indexOf('Rating requests.'),
    );
    expect(invitePass.length).toBeGreaterThan(0);
    expect(invitePass).not.toMatch(/gift card/i);
  });

  it('sends exactly one reminder, worded as a smaller ask', () => {
    expect(source).toContain('One quick favour');
  });
});

describe('the payment timestamp the timing depends on', () => {
  const webhook = codeOnly(readSource('amplify/functions/stripe-webhook/handler.ts'));

  it('is stamped when the event is marked paid', () => {
    expect(webhook).toContain('paidAt = if_not_exists(paidAt, :now)');
  });

  it('does not move when Stripe replays the webhook', () => {
    // Stripe retries. The first payment is the one that happened, and the
    // survey measures two weeks from it.
    expect(webhook).toContain('if_not_exists(paidAt');
  });

  it('is not stamped by an add-on purchase', () => {
    // Buying a slideshow is not buying the event.
    expect(webhook).toContain("const stampPaidAt = field === 'paid';");
  });
});

describe('the backend grants', () => {
  const backend = codeOnly(readSource('amplify/backend.ts'));

  it('lets the daily job open invitations and claim reminders', () => {
    expect(backend).toContain('surveyTable.grantReadWriteData(dailyTasksFn)');
    expect(backend).toContain("dailyTasksFn.addEnvironment('SURVEY_TABLE_NAME'");
  });
});
