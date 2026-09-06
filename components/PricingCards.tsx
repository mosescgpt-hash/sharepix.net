import Link from 'next/link';
import { CORPORATE_PLAN, PRICING_TIERS } from '@/lib/pricing';

/**
 * A drawn tick rather than a bare "✓" glyph: the glyph renders differently on
 * every platform and sits off the baseline. Square, no tinted disc — the disc
 * was the old rounded system.
 */
function Check({ inverted }: { inverted: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className={`mt-[5px] h-3 w-3 shrink-0 ${inverted ? 'text-mint' : 'text-pine'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M2 6.2 4.6 8.8 10 3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface PlanCardProps {
  name: string;
  price: number;
  unit: string;
  meta: string;
  features: string[];
  href: string;
  badge?: string;
  /** The recommended plan, rendered as a navy block instead of a white card. */
  featured?: boolean;
}

function PlanCard({ name, price, unit, meta, features, href, badge, featured = false }: PlanCardProps) {
  return (
    <div
      className={`flex flex-col p-7 ${
        // Depth is background colour, not elevation. The chosen plan is the
        // only inverted block in the row, which is what makes it read chosen.
        featured ? 'border border-ink bg-ink text-canvas' : 'spx-card'
      }`}
    >
      {/* Reserved even when empty, so the plan names stay on one baseline
          across the row instead of the badged card pushing its own down. */}
      <div className="min-h-[30px]">
        {badge ? (
          <span className={`spx-badge ${featured ? 'bg-mint text-charcoal' : 'bg-pine text-canvas'}`}>
            {badge}
          </span>
        ) : null}
      </div>

      <h3
        className={`mt-4 font-sans text-xs font-medium uppercase tracking-[0.16em] ${
          featured ? 'text-canvas/70' : 'text-charcoal/60'
        }`}
      >
        {name}
      </h3>

      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="font-sans text-[2.75rem] font-bold leading-none tracking-[-0.03em]">
          {price === 0 ? 'Free' : `$${price}`}
        </span>
        {/* "$0 / event" reads as a price someone forgot to fill in. A free plan
            has a word, not a number, and no unit to divide by. */}
        {price === 0 ? null : (
          <span className={`text-sm ${featured ? 'text-canvas/60' : 'text-charcoal/55'}`}>
            / {unit}
          </span>
        )}
      </p>
      <p className={`mt-2 text-sm ${featured ? 'text-canvas/60' : 'text-charcoal/55'}`}>{meta}</p>

      <div className={`my-6 h-px ${featured ? 'bg-canvas/20' : 'bg-charcoal/10'}`} />

      <ul className="flex-1 space-y-3">
        {features.map((feature) => (
          <li
            key={feature}
            className={`flex gap-2.5 text-sm leading-relaxed ${
              featured ? 'text-canvas/80' : 'text-charcoal/75'
            }`}
          >
            <Check inverted={featured} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <Link href={href} className={`${featured ? 'spx-btn-canvas' : 'spx-btn-outline'} mt-8 w-full`}>
        {price === 0 ? 'Start free' : `Choose ${name}`}
      </Link>
    </div>
  );
}

/**
 * A free trial and the plan, side by side, with Corporate as a line of prose
 * underneath.
 *
 * Corporate used to be a third card. It is a $149 monthly subscription sitting
 * beside one-time payments, which made the row read as prices to compare when
 * they are not comparable. It keeps its own page; what it loses is equal
 * billing with a decision it is not part of.
 *
 * Neither card carries a badge. With one paid plan there is nothing for it to
 * be better value than, and "Best value" set against a free trial would be an
 * odd claim to make about the thing that costs money.
 */
export default function PricingCards() {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        {PRICING_TIERS.map((tier) => (
          <PlanCard
            key={tier.id}
            name={tier.name}
            price={tier.price}
            unit="event"
            meta={
              tier.trial
                ? `${tier.accessLabel} · no card required`
                : `${tier.accessLabel} · one-time payment`
            }
            features={tier.features}
            href={`/create-event?tier=${tier.id}`}
            featured={tier.highlight}
          />
        ))}
      </div>

      <p className="spx-body mt-6 text-sm">
        Running events for a company?{' '}
        <Link href="/corporate" className="font-medium text-pine underline">
          {CORPORATE_PLAN.name} is {CORPORATE_PLAN.priceLabel}
        </Link>{' '}
        and covers multiple active events under one account.
      </p>
    </div>
  );
}
