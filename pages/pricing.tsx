import Layout from '@/components/Layout';
import PricingCards from '@/components/PricingCards';

export default function PricingPage() {
  return (
    <Layout title="Pricing">
      <section className="py-10">
        <h1 className="text-center font-display text-3xl font-extrabold sm:text-4xl">
          Pay per event, keep every memory
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-ink/70">
          No subscriptions, no per-guest fees. Pick a plan for your event, and
          everyone you invite can upload for free.
        </p>
        <div className="mt-10">
          <PricingCards />
        </div>

        <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-ink/10 bg-white p-6 text-sm text-ink/70">
          <h2 className="font-display text-lg font-bold text-ink">Common questions</h2>
          <p className="mt-3">
            <strong className="text-ink">Do guests pay anything?</strong> No.
            Guests scan the QR code and upload for free — no account or app required.
          </p>
          <p className="mt-3">
            <strong className="text-ink">How long is my event open?</strong> Guests can
            upload for <strong>30 days</strong> on every plan. You can extend the upload
            window by 30 more days anytime for half the plan price.
          </p>
          <p className="mt-3">
            <strong className="text-ink">What happens after the upload window?</strong>{' '}
            Guests keep reduced-resolution viewing for a short time (3 weeks on Starter, 30
            days on Standard/Premium), then it ends. As the host you keep full access and
            downloads for your plan&apos;s retention — 3 weeks (Starter), 3 months (Standard),
            or 1 year (Premium) — after which photos are archived and later deleted. Download
            what you want to keep before retention ends.
          </p>
          <p className="mt-3">
            <strong className="text-ink">Can I moderate photos?</strong> Every plan
            lets you delete photos. Premium adds approve-before-showing moderation.
          </p>
        </div>
      </section>
    </Layout>
  );
}
