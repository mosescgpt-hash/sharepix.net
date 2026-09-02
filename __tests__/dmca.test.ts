import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The DMCA page carries the designated agent's real contact details.
 *
 * Safe harbour under 17 U.S.C. § 512(c) requires those details to be BOTH filed
 * with the U.S. Copyright Office AND published on the site. Publishing example
 * details is worse than publishing none: a notice sent to a placeholder address
 * never reaches anyone, and the mismatch undermines the designation itself.
 *
 * So this fails the build while any placeholder remains. It is meant to be red
 * until the real registration details are filled in — that is the point of it,
 * not a bug to work around.
 */
const page = readFileSync(join(__dirname, '..', 'pages', 'dmca.tsx'), 'utf8');

/** Everything above the component, where the agent constants live. */
const constants = page.slice(0, page.indexOf('export default'));

describe('the DMCA designated agent', () => {
  it('has no placeholder left in it', () => {
    expect(constants).not.toMatch(/REPLACE_ME/);
  });

  it('gives a postal address, a phone number and an email', () => {
    // All three are required on the Copyright Office designation, so all three
    // belong on the page.
    for (const field of ['address:', 'phone:', 'email:']) {
      expect(constants).toContain(field);
    }
    expect(constants).toMatch(/email: '[^']+@[^']+\.[^']+'/);
  });

  it('records when the registration must be renewed', () => {
    // The designation lapses after three years, and a lapsed designation means
    // no safe harbour. Nothing reminds us but this.
    expect(constants).toMatch(/RENEWAL_DUE/);
  });
});

describe('the DMCA page itself', () => {
  it('describes both a notice and a counter-notice process', () => {
    // A takedown process with no counter-notice route is not a DMCA process.
    expect(page).toMatch(/counter-notification/i);
    expect(page).toMatch(/penalty of perjury/i);
  });

  it('states a repeat-infringer policy', () => {
    // Section 512(i) conditions the whole safe harbour on having one and
    // reasonably implementing it.
    expect(page).toMatch(/repeat infringer/i);
  });

  it('points elsewhere for takedowns that are not about copyright', () => {
    // The request we will actually get at an event is "I didn't want to be
    // photographed", which is not a copyright matter.
    expect(page).toMatch(/support@sharepix\.net/);
  });
});
