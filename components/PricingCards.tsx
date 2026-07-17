import Link from 'next/link';
import { PRICING_TIERS } from '@/lib/pricing';

export default function PricingCards() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {PRICING_TIERS.map((tier) => (
        <div
          key={tier.id}
          className={`flex flex-col rounded-2xl border bg-white p-6 ${
            tier.highlight ? 'border-accent shadow-lg shadow-accent/10' : 'border-ink/10'
          }`}
        >
          {tier.highlight ? (
            <span className="mb-2 self-start rounded-full bg-mint px-3 py-0.5 text-xs font-semibold text-ink">
              Most popular
            </span>
          ) : null}
          <h3 className="font-display text-xl font-bold">{tier.name}</h3>
          <p className="mt-2">
            <span className="font-display text-4xl font-bold">${tier.price}</span>
            <span className="text-ink/60"> / event</span>
          </p>
          <p className="mt-1 text-sm text-ink/60">{tier.accessLabel} · one-time payment</p>
          <ul className="mt-4 flex-1 space-y-2 text-sm">
            {tier.features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span aria-hidden className="text-accent">✓</span>
                {feature}
              </li>
            ))}
          </ul>
          <Link
            href={`/create-event?tier=${tier.id}`}
            className={`mt-6 rounded-full py-2.5 text-center font-medium ${
              tier.highlight
                ? 'bg-ink text-white hover:bg-night'
                : 'border border-ink/20 hover:border-accent hover:text-accent'
            }`}
          >
            Choose {tier.name}
          </Link>
        </div>
      ))}
    </div>
  );
}
