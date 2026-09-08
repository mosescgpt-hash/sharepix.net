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
    // The reason is now one of two, because the recipient moved out of the
    // environment and into a setting an admin edits — so "nothing was sent"
    // has to distinguish "nobody has set an address" from "there is no
    // verified sender", which are fixed in different places.
    expect(monthly).toContain('Nothing was sent —');
    expect(monthly).toContain('no recipient is set in the dashboard');
  });

  it('reports a send failure as a failure rather than a success', () => {
    expect(monthly).toContain('ok: false');
    expect(monthly).toContain('could not be emailed');
  });

  /**
   * The jobs section, located by its anchor id rather than by its heading text.
   *
   * Slicing on the words "Scheduled jobs" broke the moment the page grew a
   * section index that also contains those words: the slice started at the nav
   * link and ended before the section it was meant to read, so both assertions
   * failed on a page where nothing they check had changed. The id is on exactly
   * one element and the nav test asserts it exists.
   */
  const jobsSection = () => admin.slice(admin.indexOf('id="jobs"'), admin.indexOf('id="rewards"'));

  it('warns before running that the nightly job sends real mail', () => {
    // It is the real job, not a rehearsal, and the button has to say so.
    const section = jobsSection();
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(/sends real\s*\n?\s*mail/i);
    expect(section).toMatch(/never sent twice/i);
  });

  it('mentions when each job would have run on its own', () => {
    const section = jobsSection();
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
