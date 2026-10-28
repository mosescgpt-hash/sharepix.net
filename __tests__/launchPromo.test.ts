import { LAUNCH_PROMO_TEXT, SHOW_LAUNCH_PROMO } from '../lib/launchPromo';
import { codeOnly, readSource } from './sourceGuards';

describe('the launch promo banner', () => {
  it('says exactly what the owner wrote', () => {
    expect(LAUNCH_PROMO_TEXT).toBe(
      'Launch offer: your first Full Event is free with code SHAREFREE. Only 20 available.',
    );
  });

  it('is one flag, read by the banner and nothing else', () => {
    expect(typeof SHOW_LAUNCH_PROMO).toBe('boolean');
    expect(readSource('components/OfferBanner.tsx')).toContain('SHOW_LAUNCH_PROMO');
    expect(codeOnly(readSource('pages/index.tsx'))).not.toContain('SHOW_LAUNCH_PROMO');
  });
});

describe('the homepage order', () => {
  it('runs banner, hero, try-it, steps, promises, included, pricing, closing', () => {
    const page = codeOnly(readSource('pages/index.tsx'));
    const order = [
      '<OfferBanner />',
      '<Hero />',
      '<TryItLive />',
      '<HowItWorksSection compact />',
      '<Promises />',
      '<Included />',
      '<Pricing />',
      '<ClosingCta />',
    ].map((tag) => page.indexOf(tag));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('names the price from the tier table, not in the source', () => {
    const page = codeOnly(readSource('pages/index.tsx'));
    expect(page).not.toMatch(/\$79/);
    expect(page).toContain("getTier('plus')");
  });
});
