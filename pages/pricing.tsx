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
    a: 'Guests keep reduced-resolution viewing for 30 days, then it ends. As the host you keep full access and downloads for your plan’s retention — 3 months on Event, 1 year on Plus — after which photos are archived and later deleted. Download what you want to keep before retention ends.',
  },
  {
    q: 'Can I moderate photos?',
    a: 'Every plan lets you delete photos. Plus adds approve-before-showing moderation.',
  },
];

export default function PricingPage() {
  return (
    <Layout title="Pricing" width="bleed">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-6xl">
          <p className="spx-eyebrow">Pricing</p>
          <h1 className="mt-3">
            <span className="spx-display block">One event. One payment.</span>
            <span className="spx-display-serif block">No surprises.</span>
          </h1>
          <p className="spx-body mt-5 max-w-lg">
            Priced per event, not per guest and not per photo. Everyone you invite uploads for
            free, nothing renews, and nothing is charged until you publish.
          </p>

          <div className="mt-12">
            <PricingCards />
          </div>
        </div>
      </section>

      <section className="spx-section-sand">
        <div className="mx-auto w-full max-w-3xl">
          <p className="spx-eyebrow">Common questions</p>
          <h2 className="mt-3">
            <span className="spx-display block">The things people</span>
            <span className="spx-display-serif block">ask us first.</span>
          </h2>
          <dl className="mt-10 border-t border-charcoal/12">
            {faqs.map((faq) => (
              <div key={faq.q} className="border-b border-charcoal/12 py-7">
                <dt className="font-sans text-lg font-semibold text-charcoal">{faq.q}</dt>
                <dd className="spx-body mt-2 text-sm">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </Layout>
  );
}
