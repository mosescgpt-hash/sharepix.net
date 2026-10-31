import { bodyOf, readSource } from './sourceGuards';

/**
 * The Lambda's copy of the log vocabulary is the same text as lib's.
 *
 * Lambdas cannot import from lib/, so the validator is copied. A copy that
 * drifts would accept or scrub differently from the browser that wrote the
 * batch, and every unit test of either one would still pass.
 */
describe('record-client-log carries an identical copy of lib/clientLogSchema', () => {
  it('has the same text after the header comment', () => {
    const lib = readSource('lib/clientLogSchema.ts');
    const copy = readSource('amplify/functions/record-client-log/clientLogSchema.ts');
    expect(bodyOf(copy)).toBe(bodyOf(lib));
  });
});
