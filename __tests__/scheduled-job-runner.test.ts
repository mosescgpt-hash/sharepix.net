import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { codeOnly } from './sourceGuards';

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
const reclaim = read('amplify/functions/reclaim-storage/handler.ts');

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

  it('takes no argument that could make a real run behave differently', () => {
    // This used to assert the mutations took no arguments at all, which was a
    // proxy for the property that actually matters: nothing a caller can pass
    // may change what a run DOES. `probe` does not — it returns before any
    // work, so the choice is "report the switch" or "run the real job", with
    // no third behaviour in between.
    //
    // The proxy would now reject the probe, so it is replaced by the property.
    const runners = schema.slice(
      schema.indexOf('runDailyTasks: a'),
      schema.indexOf('.handler(a.handler.function(monthlyReportFn))') + 60,
    );
    const args = [...runners.matchAll(/\.arguments\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    for (const arg of args) {
      // One argument, named probe, boolean. Anything else is a mode switch.
      expect(arg.replace(/\s+/g, ' ').trim()).toBe('probe: a.boolean()');
    }
  });

  it('answers a probe before doing anything', () => {
    // The guarantee that makes the probe safe on the reclaim job, where a real
    // run deletes: the branch has to come first. If work happened above it,
    // "just checking the switch" would mean something else entirely.
    for (const source of [daily, reclaim]) {
      const body = source.slice(source.indexOf('export const handler = async ('));
      const probeAt = body.indexOf('arguments?.probe');
      const workAt = body.indexOf('const now = new Date();');
      expect(probeAt).toBeGreaterThan(-1);
      expect(probeAt).toBeLessThan(workAt);
    }
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

  it('shows each switch rather than describing its state in prose', () => {
    // The panel carried "It is switched off until STORAGE_RECLAIM_ENABLED is
    // set" — fine while nothing else said otherwise, and a flat contradiction
    // once a live badge above it read ON. Two places asserting one fact is how
    // they end up disagreeing; the badge is the one that can be right.
    const section = jobsSection();
    expect(section).toContain('switches[key]');
    expect(section).not.toContain('It is switched off until');
  });

  it('mentions when each job would have run on its own', () => {
    const section = jobsSection();
    expect(section).toContain('14:00 UTC');
    expect(section).toMatch(/1st of the month/i);
  });
});

describe('the handlers still work unattended', () => {
  it('does not depend on being called with arguments', () => {
    // EventBridge passes a scheduled-event shape with no `arguments` at all.
    // The parameter is optional and every read of it is optionally chained, so
    // a scheduled invocation cannot fall into the probe branch and cannot throw
    // on the way past it. Getting this wrong would stop the nightly job silently
    // — the failure mode this whole file exists for.
    for (const source of [daily, reclaim]) {
      expect(source).toContain('export const handler = async (event?: {');
      expect(source).toContain('event?.arguments?.probe');
    }
    // The monthly report has no switch and so never grew a probe.
    expect(monthly).toContain('export const handler = async () => {');
  });
});

describe('the payments panel does not claim a Stripe mode', () => {
  /**
   * It read "Payments — test mode", and underneath "No real money moves.
   * Events stay free during the pilot." Both were true when written. Neither
   * was derived from anything, so neither changed when the key became
   * `sk_live` — and the panel has buttons that open a real checkout.
   *
   * That is the same failure as the two job switches, with money attached: an
   * admin told they will not be charged, reaching for a real card because the
   * test card was declined. The page cannot read the key, so the rule is that
   * it must not pretend to.
   */
  const payments = () =>
    admin.slice(admin.indexOf('id="payments"'), admin.indexOf('id="users"'));

  it('does not assert which mode Stripe is in', () => {
    const code = codeOnly(payments());
    expect(code).not.toContain('test mode');
    expect(code).not.toContain('No real money moves');
    expect(code).not.toContain('Events stay free');
  });

  it('warns that the checkout is real', () => {
    expect(payments()).toMatch(/real Stripe checkout/);
  });

  it('names both keys, so neither reads as the assumed one', () => {
    const section = payments();
    expect(section).toContain('sk_live');
    expect(section).toContain('sk_test');
  });

  it('does not call the button a test', () => {
    // `handleTestCheckout` starting a live charge is the same lie in the code.
    expect(admin).not.toContain('handleTestCheckout');
  });
});
