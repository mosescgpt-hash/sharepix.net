import { codeOnly, readSource } from './sourceGuards';

/**
 * The weekly print price check, and the alarm that carries its result.
 *
 * ## Why this exists
 *
 * Every base cost in the print catalog was wrong against Prodigi for months.
 * Nothing noticed, because the only thing that could tell was an admin screen
 * somebody had to choose to open. Small print orders lost money on every sale
 * for the whole of that window, and it was found by accident.
 *
 * The fix is a check that runs whether or not anyone remembers. That makes it
 * unattended machinery, and unattended machinery fails quietly: the daily job
 * reports drift by *logging a string*, and a CloudWatch metric filter in
 * `backend.ts` turns that exact string into the alarm. Nothing at runtime
 * connects the two. Change the wording on one side and the alarm silently stops
 * firing — back to exactly the failure this was built to end, except now with a
 * dashboard that looks healthy.
 *
 * So the string is pinned here, from both ends.
 */

const handler = readSource('amplify/functions/daily-tasks/handler.ts');
const backend = readSource('amplify/backend.ts');

/** The literal the log line and the metric filter must agree on. */
const DRIFT_MARKER = 'PRINT PRICE DRIFT';

describe('the drift alarm is actually connected to the drift log', () => {
  it('logs the marker the metric filter watches for', () => {
    expect(handler).toContain(`console.error('${DRIFT_MARKER}'`);
  });

  it('filters on that same literal in the CDK stack', () => {
    expect(backend).toContain(`FilterPattern.literal('"${DRIFT_MARKER}"')`);
  });

  it('routes the alarm somewhere a person will see it', () => {
    // An alarm with no action is a graph nobody opens.
    expect(codeOnly(backend)).toContain('printPriceDriftAlarm.addAlarmAction');
  });

  it('gives the alarm a description that says what to do', () => {
    // Read at 2am by someone who did not write it. "PriceDrift > 0" is not
    // actionable; naming the screen and the file is.
    const described = backend.slice(backend.indexOf("alarmName: 'sharepix-print-price-drift'"));
    const description = described.slice(0, described.indexOf('metric:'));
    expect(description).toContain('Print check');
    expect(description).toContain('lib/prints.ts');
  });
});

describe('the check is weekly, and cannot break the nightly run', () => {
  it('returns early on every day but one', () => {
    // Prodigi's prices move on the scale of months. Quoting ten products every
    // night is noise, and noise is what gets alarms muted.
    expect(handler).toContain('now.getUTCDay() !== PRICE_CHECK_WEEKDAY');
  });

  it('invokes the print check rather than quoting Prodigi itself', () => {
    // A fourth hand-copied cost table is exactly the drift that caused this.
    // The comparison lives in one function; this one asks it.
    expect(handler).toContain('PRINT_CHECK_FUNCTION');
    expect(handler).not.toContain('api.prodigi.com');
    expect(handler).not.toContain('/v4.0/quotes');
  });

  it('swallows its own failures', () => {
    // An unreachable Prodigi is not a reason to skip a host's expiry reminder.
    const fn = handler.slice(
      handler.indexOf('async function checkPrintPrices'),
      handler.indexOf('export const handler'),
    );
    expect(fn).toContain('try {');
    expect(fn).toContain('catch');
    // No rethrow: the catch returns a note instead.
    expect(fn).not.toContain('throw');
  });

  it('runs after the host-facing work, not before it', () => {
    // Ordering is the whole guarantee above. If the price check moved ahead of
    // the reminder loop, a slow Prodigi would delay real mail.
    expect(handler.indexOf('const priceNote = await checkPrintPrices')).toBeGreaterThan(
      handler.indexOf('ratingsRequested += 1'),
    );
  });
});

describe('the daily job has permission to make the call', () => {
  it('is granted invoke on the print check, and told its name', () => {
    // Without both, the check fails every week and the only symptom is a
    // warning nobody reads.
    expect(backend).toContain('printCheckFn.grantInvoke(dailyTasksFn)');
    expect(backend).toContain("addEnvironment('PRINT_CHECK_FUNCTION_NAME'");
  });
});
