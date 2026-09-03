import Layout from '@/components/Layout';
import PricingCards from '@/components/PricingCards';

const faqs = [
  {
    q: 'Do guests pay anything?',
    a: 'No. Guests scan the QR code and upload for free — no account or app required.',
  },
  {
    q: 'How long is my event open?',
    a: 'Guests can upload for 30 days on every plan. You can extend the upload window by 30 more days anytime for half the plan price.',
  },
  {
    q: 'What happens after the upload window?',
    a: 'Guests keep reduced-resolution viewing for a short time (3 weeks on Starter, 30 days on Standard/Premium), then it ends. As the host you keep full access and downloads for your plan’s retention — 3 weeks (Starter), 3 months (Standard), or 1 year (Premium) — after which photos are archived and later deleted. Download what you want to keep before retention ends.',
  },
  {
    q: 'Can I moderate photos?',
    a: 'Every plan lets you delete photos. Premium adds approve-before-showing moderation.',
  },
];

export default function PricingPage() {
  return (
    <Layout title="Pricing" width="wide">
      <section className="py-14 sm:py-20">
        <div className="text-center">
          <p className="sp-eyebrow">Pricing</p>
          <h1 className="mx-auto mt-5 max-w-2xl font-display text-4xl font-bold tracking-[-0.035em] sm:text-5xl">
            Pay per event, keep every memory
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted">
            No subscriptions, no per-guest fees. Pick a plan for your event, and
            everyone you invite can upload for free.
          </p>
        </div>

        <div className="mt-14">
          <PricingCards />
        </div>

        <div className="mx-auto mt-20 max-w-2xl">
          <h2 className="text-center font-display text-2xl font-bold tracking-[-0.03em]">
            Common questions
          </h2>
          <dl className="sp-card mt-8 divide-y divide-line">
            {faqs.map((faq) => (
              <div key={faq.q} className="p-6 sm:p-7">
                <dt className="font-display font-bold tracking-tight text-ink">{faq.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </Layout>
  );
}
