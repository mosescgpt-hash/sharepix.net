import { useEffect } from 'react';
import Link from 'next/link';
import HowItWorksSection from '@/components/HowItWorksSection';
import Layout from '@/components/Layout';
import { trackEvent } from '@/lib/trackEvent';
import { faqJsonLd } from '@/lib/seo';
import type { UseCase } from '@/lib/useCases';

/**
 * The shared shape behind every use-case landing page (/weddings,
 * /graduation-parties, /corporate-events, /conventions).
 *
 * One template rather than four page files, so the sections, the FAQ markup,
 * and the structured data it generates from the same content can never drift
 * relative to each other the way four hand-written pages would.
 */
export default function UseCaseLanding({ useCase }: { useCase: UseCase }) {
  // The Discover stage — see lib/analytics.ts FUNNEL_STAGES. Mirrors the
  // homepage's own `trackEvent('homepage_view')` call exactly.
  useEffect(() => {
    trackEvent('landing_page_view', useCase.slug);
  }, [useCase.slug]);

  return (
    <Layout title={useCase.metaTitle} width="bleed" structuredData={faqJsonLd(useCase.faqs)}>
      <div className="bg-canvas font-sans">
        <section className="spx-section-canvas pt-12 sm:pt-20">
          <div className="spx-inner">
            <p className="spx-eyebrow">{useCase.eyebrow}</p>
            <h1 className="mt-3 max-w-2xl">
              <span className="spx-display block">{useCase.h1First}</span>
              <span className="spx-display-serif block">{useCase.h1Second}</span>
            </h1>
            <p className="spx-body mt-5 max-w-xl">{useCase.heroBody}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/create-event" className="spx-btn-ink">
                Create your free event
              </Link>
              <Link href="/demo/gallery" className="spx-btn-outline">
                See a sample gallery
              </Link>
            </div>
          </div>
        </section>

        <HowItWorksSection />

        <section className="spx-section-sand">
          <div className="spx-inner">
            <p className="spx-eyebrow">Why it works</p>
            <div className="mt-8 grid gap-px bg-charcoal/10 sm:grid-cols-2">
              {useCase.benefits.map((benefit) => (
                <div key={benefit} className="bg-canvas p-7">
                  <p className="text-lg font-semibold leading-snug">{benefit}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="spx-section-canvas">
          <div className="spx-inner max-w-3xl">
            <p className="spx-eyebrow">Questions</p>
            <h2 className="mt-3 spx-display">Frequently asked questions</h2>
            <dl className="mt-10 divide-y divide-charcoal/10 border-y border-charcoal/10">
              {useCase.faqs.map((faq) => (
                <div key={faq.question} className="py-6">
                  <dt className="text-lg font-semibold">{faq.question}</dt>
                  <dd className="spx-body mt-2 text-sm">{faq.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="spx-section-ink text-center">
          <div className="spx-inner">
            <p className="spx-eyebrow">Ready when you are</p>
            <h2 className="mt-3">
              <span className="spx-display block">Set it up in five minutes.</span>
              <span className="spx-display-serif block">Your first event is free.</span>
            </h2>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/create-event" className="spx-btn-canvas">
                Create your event
              </Link>
              <Link href="/pricing" className="spx-btn-outline">
                See pricing
              </Link>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
