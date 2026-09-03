import Link from 'next/link';
import { ReactNode } from 'react';
import { CORPORATE_PLAN, PRICING_TIERS } from '@/lib/pricing';

/**
 * A drawn tick in a tinted disc, rather than a bare "✓" glyph in green text.
 * The glyph renders differently on every platform and sits off the baseline;
 * this is the same mark everywhere and gives the feature list a left rail.
 */
function Check() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M2.5 6.2 4.8 8.5 9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: 'accent' | 'quiet' }) {
  return (
    <span
      className={`self-start whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
        tone === 'accent' ? 'bg-accent text-white' : 'bg-ink/[0.06] text-ink/70'
      }`}
    >
      {children}
    </span>
  );
}

interface PlanCardProps {
  name: string;
  price: number;
  unit: string;
  meta: string;
  features: string[];
  href: string;
  badge?: { label: string; tone: 'accent' | 'quiet' };
  highlight?: boolean;
}

function PlanCard({ name, price, unit, meta, features, href, badge, highlight }: PlanCardProps) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl p-7 transition duration-200 ease-out ${
        highlight
          ? // The recommended plan is raised off the row rather than merely
            // outlined — height is what makes a choice look chosen.
            'border border-accent/30 bg-card shadow-float ring-1 ring-accent/15 xl:-my-3 xl:py-10'
          : 'sp-card sp-card-interactive'
      }`}
    >
      {/* The badge gets its own line. Beside the plan name it wraps to two
          lines in a four-column row and shoves the title around. */}
      <div className="flex min-h-[26px] items-start">
        {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
      </div>
      <h3 className="mt-3 font-display text-lg font-bold tracking-tight">{name}</h3>

      <p className="mt-3 flex items-baseline gap-1">
        <span className="font-display text-[2.75rem] font-bold leading-none tracking-[-0.04em] tabular">
          ${price}
        </span>
        <span className="text-sm text-muted">/ {unit}</span>
      </p>
      <p className="mt-2 text-sm text-muted">{meta}</p>

      <div className="my-6 h-px bg-line" />

      <ul className="flex-1 space-y-3 text-sm leading-relaxed text-ink/80">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2.5">
            <Check />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <Link
        href={href}
        className={`mt-8 rounded-full py-3 text-center text-sm font-semibold transition duration-200 ease-out ${
          highlight
            ? 'bg-ink text-white shadow-lift hover:bg-night hover:shadow-float'
            : 'border border-line bg-card text-ink hover:border-ink/25 hover:shadow-card'
        }`}
      >
        Choose {name}
      </Link>
    </div>
  );
}

export default function PricingCards() {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      {PRICING_TIERS.map((tier) => (
        <PlanCard
          key={tier.id}
          name={tier.name}
          price={tier.price}
          unit="event"
          meta={`${tier.accessLabel} · one-time payment`}
          features={tier.features}
          href={`/create-event?tier=${tier.id}`}
          badge={tier.highlight ? { label: 'Most popular', tone: 'accent' } : undefined}
          highlight={tier.highlight}
        />
      ))}
      <PlanCard
        name={CORPORATE_PLAN.name}
        price={CORPORATE_PLAN.price}
        unit="month"
        meta={CORPORATE_PLAN.accessLabel}
        features={CORPORATE_PLAN.features}
        href="/corporate"
        badge={{ label: 'For teams', tone: 'quiet' }}
      />
    </div>
  );
}
