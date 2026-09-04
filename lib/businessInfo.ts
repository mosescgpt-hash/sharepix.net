/**
 * Who SharePix legally is, and how to reach the business in writing.
 *
 * One module because these values appear on several public pages and in
 * several external registrations, and the failure mode of drift is not
 * cosmetic: a DMCA agent address that disagrees with the Copyright Office
 * registration undermines the designation, and a Terms page naming a different
 * address than the state filing is the kind of thing that gets noticed at
 * exactly the wrong moment.
 *
 * Change the address HERE and every page follows. Then work through
 * docs/business-records.md, which lists the external records that also carry it
 * — those cannot be updated from this repository and are the ones that actually
 * go stale.
 */

/** The legal entity behind the product. */
export const LEGAL_ENTITY = 'SharePix LLC';

/**
 * The business mailing address, one line per array entry.
 *
 * Deliberately a registered-agent address rather than a home one: it is
 * published on the site, filed with the U.S. Copyright Office, and (once
 * amended) on the Minnesota Secretary of State record, so it is public in three
 * places at once.
 */
export const BUSINESS_ADDRESS_LINES = [
  LEGAL_ENTITY,
  '617 Locust Street #1001',
  'Monticello, MN 55362',
  'United States',
];

/** The same address as a single string, for a <p> with whitespace-pre-line. */
export const BUSINESS_ADDRESS = BUSINESS_ADDRESS_LINES.join('\n');

/**
 * The DMCA designated agent, exactly as registered with the U.S. Copyright
 * Office. The address is the business address above — they must match.
 *
 * The designation lapses after three years, and a lapsed designation means no
 * safe harbour. `DMCA_RENEWAL_DUE` is the only thing tracking that.
 */
export const DMCA_AGENT = {
  name: 'Seth Calvin',
  organization: LEGAL_ENTITY,
  address: BUSINESS_ADDRESS,
  phone: '(320) 295-2850',
  email: 'seth@sharepix.net',
};

/** Three years from the September 2, 2026 registration. */
export const DMCA_RENEWAL_DUE = 'September 2, 2029';

/**
 * Where different kinds of mail go. These are deliberately separate addresses,
 * not an inconsistency: a copyright notice, a privacy request and a support
 * question are handled differently and by different processes.
 */
export const SUPPORT_EMAIL = 'support@sharepix.net';
export const PRIVACY_EMAIL = 'privacy@sharepix.net';
