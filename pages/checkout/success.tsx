import Link from 'next/link';
import Layout from '@/components/Layout';

export default function CheckoutSuccessPage() {
  return (
    <Layout title="Payment received">
      <section className="mx-auto max-w-lg py-16 text-center">
        <span className="text-5xl" aria-hidden>
          🎉
        </span>
        <h1 className="mt-4 font-display text-3xl font-extrabold">Payment received</h1>
        <p className="mt-3 text-ink/70">
          Thanks! Your test payment went through on Stripe. During the pilot, events remain free —
          this confirms the checkout is working end to end.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/global-admin"
            className="rounded-full bg-ink px-6 py-3 font-medium text-white hover:bg-night"
          >
            Back to admin
          </Link>
          <Link
            href="/"
            className="rounded-full border border-ink/20 px-6 py-3 font-medium hover:border-accent"
          >
            Home
          </Link>
        </div>
      </section>
    </Layout>
  );
}
