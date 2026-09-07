import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Running the scheduled jobs on demand.
 *
 * Scheduled work is the easiest kind to ship broken: it runs once a day at an
 * hour nobody is watching, writes to CloudWatch, and the first evidence that it
 * failed is a customer who was never warned their photos were about to be
 * deleted. These guard the properties that make the admin trigger worth having
 * — that it runs the REAL job, and that it cannot silently become a rehearsal.
 */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const schema = read('amplify/data/resource.ts');
const admin = read('pages/global-admin.tsx');
const daily = read('amplify/functions/daily-tasks/handler.ts');
const monthly = read('amplify/functions/monthly-report/handler.ts');

describe('the admin trigger runs the real job', () => {
  it('points at the same functions the schedules invoke', () => {
    // A test double would prove nothing about the thing that actually runs at
    // 14:00 UTC.
    expect(schema).toContain('.handler(a.handler.function(dailyTasksFn))');
    expect(schema).toContain('.handler(a.handler.function(monthlyReportFn))');
  });

  it('is admin-only', () => {
    const runners = schema.slice(
      schema.indexOf('runDailyTasks: a'),
      schema.indexOf('.handler(a.handler.function(monthlyReportFn))') + 60,
    );
    expect(runners).toContain("allow.group('ADMINS')");
    expect(runners).not.toContain('allow.authenticated()');
    expect(runners).not.toContain('allow.guest()');
  });

  it('does not change what the job does when run by hand', () => {
    // No "test mode" argument anywhere: the mutation takes no arguments, so
    // there is nothing to pass that could make it behave differently.
    const runners = schema.slice(
      schema.indexOf('runDailyTasks: a'),
      schema.indexOf('.handler(a.handler.function(monthlyReportFn))') + 60,
    );
    expect(runners).not.toContain('.arguments(');
  });
});

describe('what the operator is told', () => {
  it('says whether anything was actually sent', () => {
    // The one thing an operator must not have to guess is whether they just
    // mailed real customers.
    expect(daily).toContain('Nothing was sent — EMAIL_SENDING_ENABLED is off.');
    expect(monthly).toContain('Nothing was sent — no REPORT_TO_ADDRESS is configured.');
  });

  it('reports a send failure as a failure rather than a success', () => {
    expect(monthly).toContain('ok: false');
    expect(monthly).toContain('could not be emailed');
  });

  it('warns before running that the nightly job sends real mail', () => {
    // It is the real job, not a rehearsal, and the button has to say so.
    const section = admin.slice(admin.indexOf('Scheduled jobs'), admin.indexOf('Research rewards'));
    expect(section).toMatch(/sends real\s*\n?\s*mail/i);
    expect(section).toMatch(/never sent twice/i);
  });

  it('mentions when each job would have run on its own', () => {
    const section = admin.slice(admin.indexOf('Scheduled jobs'), admin.indexOf('Research rewards'));
    expect(section).toContain('14:00 UTC');
    expect(section).toMatch(/1st of the month/i);
  });
});

describe('the handlers still work unattended', () => {
  it('take no arguments, so a scheduled invocation is identical', () => {
    // EventBridge passes an event object the handler must not depend on.
    expect(daily).toContain('export const handler = async () => {');
    expect(monthly).toContain('export const handler = async () => {');
  });
});
