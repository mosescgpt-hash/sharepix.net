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
            <strong className="text-ink">What happens when access expires?</strong>{' '}
            The gallery becomes read-only for you as the host; download everything
            before the window closes, or upgrade the event.
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
