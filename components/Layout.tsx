import Head from 'next/head';
import Link from 'next/link';
import { ReactNode } from 'react';
import Navbar from '@/components/Navbar';

interface LayoutProps {
  title?: string;
  children: ReactNode;
}

export default function Layout({ title, children }: LayoutProps) {
  const pageTitle = title
    ? `${title} — sharepix.net`
    : 'sharepix.net — Capture. Connect. Celebrate.';
  return (
    <div className="min-h-screen bg-smoke font-body text-ink">
      <Head>
        <title>{pageTitle}</title>
        <meta
          name="description"
          content="Every guest is a photographer. Create an event, print a QR code, and collect everyone's photos in one gallery."
        />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </Head>
      <Navbar />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        {children}
      </main>
      <footer className="border-t-4 border-mint bg-ink py-6 text-center text-sm text-white/80">
        <p>sharepix.net · Capture. Connect. Celebrate. · event plans plus Corporate monthly</p>
        <p className="mt-2">
          <Link href="/privacy" className="text-white/70 underline hover:text-white">
            Privacy Policy
          </Link>
        </p>
      </footer>
    </div>
  );
}
