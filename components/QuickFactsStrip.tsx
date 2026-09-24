import { PRICING_TIERS, GALLERY_MONTHS, UPLOAD_WINDOW_DAYS } from '@/lib/pricing';

const FREE_TIER = PRICING_TIERS.find((tier) => tier.price === 0);
const PAID_TIER = PRICING_TIERS.find((tier) => tier.price > 0);

const FACTS = [
  { figure: `${FREE_TIER?.photoLimit ?? 50} photos`, label: 'Free to try, no card needed' },
  { figure: `${UPLOAD_WINDOW_DAYS} days`, label: 'Guests can keep uploading' },
  { figure: `${GALLERY_MONTHS} months`, label: 'Gallery stays up after, on the paid plan' },
  { figure: `$${PAID_TIER?.price ?? 79}`, label: 'One time, for the whole event' },
];

/**
 * The numbers behind the claims, in one glance. Every figure is read from
 * lib/pricing.ts rather than typed as a literal — see lib/seo.ts's own note on
 * PAID_TIER_PRICE for why: a number typed into copy is a number that keeps
 * saying $79 six months after the price moved.
 */
export default function QuickFactsStrip() {
  return (
    <section className="spx-section-sand py-10 sm:py-14">
      <div className="spx-inner grid grid-cols-2 gap-8 sm:grid-cols-4">
        {FACTS.map((fact) => (
          <div key={fact.label}>
            <p className="spx-stat-figure">{fact.figure}</p>
            <p className="spx-stat-label">{fact.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
