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
          ${price}
        </span>
        <span className={`text-sm ${featured ? 'text-canvas/60' : 'text-charcoal/55'}`}>
          / {unit}
        </span>
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
        Choose {name}
      </Link>
    </div>
  );
}

export default function PricingCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {PRICING_TIERS.map((tier) => (
        <PlanCard
          key={tier.id}
          name={tier.name}
          price={tier.price}
          unit="event"
          meta={`${tier.accessLabel} · one-time payment`}
          features={tier.features}
          href={`/create-event?tier=${tier.id}`}
          // "Best value", not "Most popular": Plus folds in $48 of add-ons
          // for $30 more than Event, which is checkable. Nothing has sold yet,
          // so popularity would be invented.
          badge={tier.highlight ? 'Best value' : undefined}
          featured={tier.highlight}
        />
      ))}
      <PlanCard
        name={CORPORATE_PLAN.name}
        price={CORPORATE_PLAN.price}
        unit="month"
        meta={CORPORATE_PLAN.accessLabel}
        features={CORPORATE_PLAN.features}
        href="/corporate"
        badge="For teams"
      />
    </div>
  );
}
