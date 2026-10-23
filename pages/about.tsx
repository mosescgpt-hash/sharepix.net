import Link from 'next/link';
import Layout from '@/components/Layout';
import { DMCA_AGENT, LEGAL_ENTITY } from '@/lib/businessInfo';

/** Deliberately short: only facts the business records already state. */
export default function AboutPage() {
  return (
    <Layout title="About" width="bleed">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-3xl">
          <p className="spx-eyebrow">About</p>
          <h1 className="mt-3">
            <span className="spx-display block">Built by {DMCA_AGENT.name}.</span>
          </h1>
          <p className="spx-body mt-5 max-w-lg">
            SharePix is made by {LEGAL_ENTITY}, a Minnesota company, and is built and run by{' '}
            {DMCA_AGENT.name}. It does one job: everyone at your event scans one
            code and their photos land in one gallery, with no app and no sign-up for
            guests.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/create-event" className="spx-btn-ink">
              Create an event
            </Link>
            <Link href="/contact" className="spx-btn-outline">
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
