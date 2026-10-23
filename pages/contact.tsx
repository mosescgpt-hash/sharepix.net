import Link from 'next/link';
import Layout from '@/components/Layout';
import { BUSINESS_ADDRESS, LEGAL_ENTITY, PRIVACY_EMAIL } from '@/lib/businessInfo';
import { SUPPORT_EMAIL } from '@/lib/help';

/**
 * How to reach SharePix. Every address here comes from lib/businessInfo.ts or
 * lib/help.ts, the same values the footer, privacy and DMCA pages use.
 */
export default function ContactPage() {
  return (
    <Layout title="Contact us" width="bleed">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-3xl">
          <p className="spx-eyebrow">Contact</p>
          <h1 className="mt-3">
            <span className="spx-display block">Get in touch.</span>
          </h1>
          <p className="spx-body mt-5 max-w-lg">
            Questions about an event, a payment, or how something works? Email us and a
            real person will answer. Many answers are already in the{' '}
            <Link href="/help" className="text-pine underline">
              help pages
            </Link>
            .
          </p>

          <dl className="mt-10 border-t border-charcoal/12">
            <div className="border-b border-charcoal/12 py-6">
              <dt className="font-sans text-lg font-semibold">Questions and help</dt>
              <dd className="spx-body mt-1 text-sm">
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-pine underline">
                  {SUPPORT_EMAIL}
                </a>
              </dd>
            </div>
            <div className="border-b border-charcoal/12 py-6">
              <dt className="font-sans text-lg font-semibold">Privacy requests</dt>
              <dd className="spx-body mt-1 text-sm">
                <a href={`mailto:${PRIVACY_EMAIL}`} className="text-pine underline">
                  {PRIVACY_EMAIL}
                </a>{' '}
                — see the{' '}
                <Link href="/privacy" className="text-pine underline">
                  privacy policy
                </Link>
                .
              </dd>
            </div>
            <div className="border-b border-charcoal/12 py-6">
              <dt className="font-sans text-lg font-semibold">Copyright notices</dt>
              <dd className="spx-body mt-1 text-sm">
                Follow the steps on the{' '}
                <Link href="/dmca" className="text-pine underline">
                  copyright page
                </Link>
                .
              </dd>
            </div>
            <div className="border-b border-charcoal/12 py-6">
              <dt className="font-sans text-lg font-semibold">By mail</dt>
              <dd className="spx-body mt-1 whitespace-pre-line text-sm">{BUSINESS_ADDRESS}</dd>
            </div>
          </dl>
          <p className="mt-6 text-sm text-charcoal/70">
            sharepix.net is run by {LEGAL_ENTITY}.
          </p>
        </div>
      </section>
    </Layout>
  );
}
