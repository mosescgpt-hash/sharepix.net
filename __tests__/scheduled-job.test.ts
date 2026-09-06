import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The product's first scheduled job, pinned at the source.
 *
 * Verified once against a real CDK synth: `defineFunction({ schedule })`
 * produces an `AWS::Scheduler::Schedule` with `cron(0 14 * * ? *)`, timezone
 * UTC, targeting the daily-tasks Lambda. That check cannot run here — synth
 * needs the full backend and takes minutes — so these guard the inputs that
 * produced it, and the behaviours around it that are silent when wrong.
 */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const resource = read('amplify/functions/daily-tasks/resource.ts');
const handler = read('amplify/functions/daily-tasks/handler.ts');
const backend = read('amplify/backend.ts');

describe('the schedule', () => {
  it('runs daily at a fixed hour, not at whatever time we last deployed', () => {
    // `every day` anchors to deploy time and moves whenever we ship, which
    // eventually means mailing half the audience at 3am.
    expect(resource).toContain("schedule: '0 14 * * ? *'");
    expect(resource).not.toContain("schedule: 'every day'");
  });

  it('gives the job long enough to finish a scan', () => {
    expect(resource).toContain('timeoutSeconds: 600');
  });
});

describe('sending is off until someone turns it on', () => {
  it('gates every send behind an environment variable', () => {
    // The job ships able to run, decide and log, and unable to send. That is
    // how something that mails real customers gets watched in production
    // before it is trusted.
    expect(handler).toContain("process.env.EMAIL_SENDING_ENABLED ?? '').toLowerCase() === 'true'");
    expect(backend).toContain("'EMAIL_SENDING_ENABLED'");
  });

  it('records nothing during a dry run', () => {
    // Claiming milestones in dry-run would mean that turning sending on later
    // skipped every reminder as already done — the job would go live having
    // silently spent its whole backlog.
    const dryRun = handler.slice(handler.indexOf('if (!SENDING_ENABLED) {'));
    const block = dryRun.slice(0, dryRun.indexOf('}'));
    expect(block).toContain('[dry-run]');
    expect(block).not.toContain('claimMilestone');
  });

  it('bounds how much one run will send', () => {
    expect(handler).toContain('MAX_SENDS_PER_RUN');
  });
});

describe('sending twice is impossible', () => {
  it('claims a milestone with a conditional put before sending it', () => {
    // A scheduler that double-fires, or a run that retries after timing out
    // mid-batch, must not mail every host twice. The second copy is the one
    // that makes people distrust the first.
    const claim = handler.slice(handler.indexOf('async function claimMilestone'));
    expect(claim.slice(0, 1200)).toContain("ConditionExpression: 'attribute_not_exists(id)'");
    expect(claim.slice(0, 1200)).toContain('ConditionalCheckFailedException');
  });

  it('claims before sending, not after', () => {
    // A crash between the two costs a reminder rather than duplicating one,
    // and of those two failures the duplicate is the worse one.
    const claimCall = handler.indexOf("claimMilestone(event.id, due.daysBefore, 'sent'");
    const sendCall = handler.indexOf('await send(to, message.subject');
    expect(claimCall).toBeGreaterThan(-1);
    expect(sendCall).toBeGreaterThan(claimCall);
  });

  it('records milestones that lapsed, so they can never fire late', () => {
    expect(handler).toContain("claimMilestone(event.id, days, 'lapsed', nowISO)");
  });
});

describe('what the job may touch', () => {
  it('reads events and cannot write them', () => {
    // An unattended nightly job running against every row should not be able
    // to modify an event, and nothing it does needs to.
    expect(backend).toContain('eventTable.grantReadData(dailyTasksFn)');
    expect(backend).not.toContain('eventTable.grantReadWriteData(dailyTasksFn)');
    expect(backend).not.toContain('eventTable.grantWriteData(dailyTasksFn)');
  });

  it('can write only its own notification and preference tables', () => {
    expect(backend).toContain('notificationTable.grantReadWriteData(dailyTasksFn)');
    expect(backend).toContain('emailPreferenceTable.grantReadWriteData(dailyTasksFn)');
  });

  it('skips events that were never paid for', () => {
    // Nothing to lose, and nobody expecting to keep it.
    expect(handler).toContain('if (!event.id || !event.paid) continue;');
  });
});

describe('failures stay local', () => {
  it('does not log the address it failed to mail', () => {
    // These logs are read by more people than the mail is sent to.
    const sendFn = handler.slice(handler.indexOf('async function send('));
    const catchBlock = sendFn.slice(sendFn.indexOf('} catch (error) {'), sendFn.indexOf('return false;\n  }\n}'));
    expect(catchBlock).not.toMatch(/\bto\b\s*,/);
  });

  it('keeps one bad event from stopping the rest', () => {
    // One malformed row must not cost ninety-nine other hosts their warning.
    expect(handler).toMatch(/catch \{\s*continue;\s*\}/);
  });
});
