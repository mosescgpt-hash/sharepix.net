import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUSINESS_ADDRESS,
  BUSINESS_ADDRESS_LINES,
  DMCA_AGENT,
  DMCA_RENEWAL_DUE,
  LEGAL_ENTITY,
} from '../lib/businessInfo';

/**
 * The business address appears on three public pages and in several external
 * registrations (see docs/business-records.md). Pages disagreeing with each
 * other is the failure this guards; the external records are on the human.
 */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const LEGAL_PAGES = ['pages/dmca.tsx', 'pages/terms.tsx', 'pages/privacy.tsx'];

describe('the business address has one source', () => {
  it('is complete enough to post a letter to', () => {
    expect(BUSINESS_ADDRESS_LINES.length).toBeGreaterThanOrEqual(3);
    expect(BUSINESS_ADDRESS).toContain(LEGAL_ENTITY);
    // A street line and a city/state/ZIP line, at minimum.
    expect(BUSINESS_ADDRESS).toMatch(/\d/);
    expect(BUSINESS_ADDRESS).toMatch(/[A-Z]{2}\s+\d{5}/);
  });

  it('is what the DMCA agent uses, since the two must match the registration', () => {
    expect(DMCA_AGENT.address).toBe(BUSINESS_ADDRESS);
    expect(DMCA_AGENT.organization).toBe(LEGAL_ENTITY);
  });

  it('gives the agent a phone and an email, both required on the designation', () => {
    expect(DMCA_AGENT.phone).toMatch(/\d/);
    expect(DMCA_AGENT.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(DMCA_AGENT.name.trim().length).toBeGreaterThan(0);
  });

  it('records a renewal date, because the designation lapses after three years', () => {
    expect(DMCA_RENEWAL_DUE).toMatch(/\d{4}/);
  });

  it('carries no placeholder', () => {
    const values = [BUSINESS_ADDRESS, LEGAL_ENTITY, ...Object.values(DMCA_AGENT)];
    for (const value of values) {
      expect(value).not.toMatch(/REPLACE_ME|TODO|example\.com|Lorem/i);
    }
  });
});

describe('no page hardcodes its own address', () => {
  it.each(LEGAL_PAGES)('%s reads it from lib/businessInfo', (path) => {
    expect(read(path)).toContain("from '@/lib/businessInfo'");
  });

  it.each(LEGAL_PAGES)('%s names the entity from the module, not a literal', (path) => {
    // The entity name was hardcoded on Terms and Privacy while businessInfo
    // held the real one, so renaming the company missed two pages. Anything
    // that looks like a company name spelled out in the page is the bug.
    const source = read(path);
    expect(source).not.toMatch(/\b[A-Z][a-z]+\s+(?:Solutions|Holdings|Ventures|Media|Group)\s+(?:LLC|Inc\.?|L\.L\.C\.)/);
    // The one legitimate spelling of it is the constant.
    expect(source).toContain('LEGAL_ENTITY');
  });

  it.each(LEGAL_PAGES)('%s contains no street address of its own', (path) => {
    // A second copy is how two pages start disagreeing. The street number and
    // the "MN 55362" pattern are the shapes that would show up.
    const source = read(path);
    expect(source).not.toMatch(/\d{2,5}\s+[A-Z][a-z]+\s+(Street|St|Ave|Avenue|Road|Rd|Drive|Dr)\b/);
    expect(source).not.toMatch(/[A-Z]{2}\s+\d{5}/);
  });
});

describe('the pages that must show it, do', () => {
  it('shows a postal address on the DMCA page', () => {
    // Required: 17 U.S.C. § 512(c) wants the agent reachable from the site.
    expect(read('pages/dmca.tsx')).toMatch(/AGENT\.address|BUSINESS_ADDRESS/);
  });

  it('shows one on Terms and Privacy too', () => {
    // Not strictly required, but a consumer-facing business that sells physical
    // goods and takes a subscription should be reachable in writing.
    for (const path of ['pages/terms.tsx', 'pages/privacy.tsx']) {
      expect(read(path)).toContain('BUSINESS_ADDRESS');
    }
  });
});

describe('the record of what else carries the address', () => {
  const doc = read('docs/business-records.md');

  it('names every external record, since none of them is visible to CI', () => {
    for (const record of ['Copyright Office', 'Secretary of State', 'Stripe', 'Prodigi']) {
      expect(doc).toContain(record);
    }
  });

  it('states the same renewal date the code does', () => {
    expect(doc).toContain(DMCA_RENEWAL_DUE);
  });

  it('states the same address the code does', () => {
    for (const line of BUSINESS_ADDRESS_LINES) {
      expect(doc).toContain(line);
    }
  });
});
