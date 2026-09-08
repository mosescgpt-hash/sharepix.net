import {
  HOME_JURISDICTION_NOTE,
  NEXUS_DISCLAIMER,
  NEXUS_WARN_FRACTION,
  US_NEXUS_SALES_USD,
  US_NEXUS_TRANSACTIONS,
  assessNexus,
  nexusMessages,
} from '../lib/taxNexus';
import { codeOnly, readSource } from './sourceGuards';

/** A $79 sale in a given place. */
const sale = (country: string, region = '') => ({
  country,
  region,
  amountCents: 7900,
});

describe('the tripwire stays quiet until it should not', () => {
  it('says nothing about an ordinary run of domestic sales', () => {
    const assessment = assessNexus(Array.from({ length: 40 }, () => sale('US', 'MN')));
    expect(assessment.actionNeeded).toBe(false);
    expect(nexusMessages(assessment)).toEqual([]);
  });

  it('says nothing at all when there are no sales yet', () => {
    for (const input of [[], null, undefined]) {
      const assessment = assessNexus(input);
      expect(assessment.actionNeeded).toBe(false);
      expect(nexusMessages(assessment)).toEqual([]);
    }
  });

  it('renders nothing rather than "no tax issues"', () => {
    // A panel reading "you are fine" is advice. This file is a prompt to check
    // with somebody qualified, and the difference matters.
    const page = readSource('pages/global-admin.tsx');
    expect(page).toContain('nexus?.actionNeeded ?');
    expect(codeOnly(page)).not.toMatch(/no tax issues/i);
  });
});

describe('the first international sale', () => {
  it('fires immediately, on one sale', () => {
    // EU VAT on digital services has NO threshold. A count-based rule would be
    // wrong by construction, so this is deliberately not a threshold at all.
    const assessment = assessNexus([...Array.from({ length: 5 }, () => sale('US', 'MN')), sale('DE')]);
    expect(assessment.hasInternationalSales).toBe(true);
    expect(assessment.internationalCountries).toEqual(['DE']);
    expect(assessment.actionNeeded).toBe(true);
    expect(nexusMessages(assessment)[0]).toMatch(/no threshold/i);
  });

  it('lists each country once, in a stable order', () => {
    const assessment = assessNexus([sale('GB'), sale('DE'), sale('GB'), sale('CA')]);
    expect(assessment.internationalCountries).toEqual(['CA', 'DE', 'GB']);
  });

  it('is the trigger that actually justifies the fee', () => {
    // The whole reason this is a trigger rather than something done up front:
    // a merchant of record costs about 2.4% of revenue forever.
    expect(nexusMessages(assessNexus([sale('FR')])).join(' ')).toMatch(
      /merchant of record/i,
    );
  });
});

describe('US state thresholds', () => {
  it('warns on approach rather than on arrival', () => {
    // Registering takes weeks. A tripwire that fires on arrival fires too late
    // to be useful.
    const nearly = Math.ceil(US_NEXUS_TRANSACTIONS * NEXUS_WARN_FRACTION);
    const assessment = assessNexus(Array.from({ length: nearly }, () => sale('US', 'CA')));
    expect(assessment.jurisdictions).toHaveLength(1);
    expect(assessment.jurisdictions[0].approaching).toBe(true);
    expect(assessment.jurisdictions[0].overThreshold).toBe(false);
    expect(nexusMessages(assessment)[0]).toMatch(/approaching/i);
    expect(NEXUS_WARN_FRACTION).toBeLessThan(1);
  });

  it('crosses on either measure, not both', () => {
    // A state's rule is "sales OR transactions". Requiring both would miss the
    // case each threshold exists to catch.
    const byCount = assessNexus(
      Array.from({ length: US_NEXUS_TRANSACTIONS }, () => sale('US', 'TX')),
    );
    expect(byCount.jurisdictions[0].overThreshold).toBe(true);

    const byValue = assessNexus([
      { country: 'US', region: 'NY', amountCents: US_NEXUS_SALES_USD * 100 },
    ]);
    expect(byValue.jurisdictions[0].overThreshold).toBe(true);
  });

  it('keeps states separate, because nexus is per state', () => {
    // 150 sales spread over two states is not 150 sales in one.
    const mixed = [
      ...Array.from({ length: 150 }, () => sale('US', 'MN')),
      ...Array.from({ length: 150 }, () => sale('US', 'WI')),
    ];
    const assessment = assessNexus(mixed);
    for (const row of assessment.jurisdictions) {
      expect(row.transactions).toBe(150);
      expect(row.overThreshold).toBe(false);
    }
  });

  it('puts the states already over the line first', () => {
    const rows = [
      ...Array.from({ length: US_NEXUS_TRANSACTIONS }, () => sale('US', 'TX')),
      ...Array.from({ length: 170 }, () => sale('US', 'CA')),
    ];
    const assessment = assessNexus(rows);
    expect(assessment.jurisdictions[0].jurisdiction).toBe('TX');
    expect(assessment.jurisdictions[0].overThreshold).toBe(true);
    expect(assessment.jurisdictions[1].overThreshold).toBe(false);
  });
});

describe('sales it cannot attribute', () => {
  it('counts them and says the totals are understated', () => {
    // A pile of these means the address is not being captured, and every
    // number above is wrong in the dangerous direction. Silently dropping
    // them would hide exactly that.
    const assessment = assessNexus([
      sale('US', 'MN'),
      { country: '', region: '', amountCents: 7900 },
      { country: 'US', region: '', amountCents: 7900 },
    ]);
    expect(assessment.unknownJurisdictionSales).toBe(2);
    expect(nexusMessages(assessment).join(' ')).toMatch(/understated/i);
  });

  it('does not let an unattributable sale count toward a state', () => {
    const assessment = assessNexus([{ country: 'US', amountCents: 999_999_99 }]);
    expect(assessment.jurisdictions).toEqual([]);
  });
});

describe('it never pretends to be advice', () => {
  it('carries the disclaimer wherever it is shown', () => {
    expect(NEXUS_DISCLAIMER).toMatch(/not tax advice/i);
    expect(HOME_JURISDICTION_NOTE).toMatch(/physical presence/i);
    const page = readSource('pages/global-admin.tsx');
    expect(page).toContain('NEXUS_DISCLAIMER');
    expect(page).toContain('HOME_JURISDICTION_NOTE');
  });

  it('says the thresholds vary rather than stating them as the rule', () => {
    // $100k / 200 transactions is the COMMON threshold. Several states differ,
    // and presenting a rule of thumb as the law is how somebody registers in
    // the wrong place or fails to register in the right one.
    const source = readSource('lib/taxNexus.ts');
    expect(source).toMatch(/a guide, not the law/i);
    expect(NEXUS_DISCLAIMER).toMatch(/vary by state/i);
  });

  it('decides nothing and changes nothing on its own', () => {
    // It reads sales and returns words. No writes, no registrations, no
    // provider switch — every one of those is a person's decision.
    const code = codeOnly(readSource('lib/taxNexus.ts'));
    for (const forbidden of ['fetch(', 'Command', 'process.env', 'await ']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('the sale data it reads', () => {
  it('records country and region on the payment, and nothing finer', () => {
    // A street address would be personal data with no use here.
    const webhook = readSource('amplify/functions/stripe-webhook/handler.ts');
    expect(webhook).toContain('billingCountry');
    expect(webhook).toContain('billingRegion');
    expect(codeOnly(webhook)).not.toContain('address?.line1');
    expect(codeOnly(webhook)).not.toContain('address?.postal_code');
  });

  it('only exists because automatic_tax makes Stripe collect an address', () => {
    // Before that there was no address on the session to record.
    expect(readSource('amplify/functions/stripe-checkout/handler.ts')).toContain(
      'automatic_tax: AUTOMATIC_TAX',
    );
  });
});
