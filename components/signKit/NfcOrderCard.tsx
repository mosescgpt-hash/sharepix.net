import { NFC_STORE_AFFILIATE, NFC_STORE_LINKS, NFC_STORE_NAME } from '@/lib/signKit/nfcStore';

/** "Order NFC stickers": links out to a retailer. Shown on the Signs and NFC pages. */
export default function NfcOrderCard({ className = '' }: { className?: string }) {
  return (
    <section className={`border border-ink/10 bg-white p-4 ${className}`} aria-labelledby="nfc-order-heading">
      <h2 id="nfc-order-heading" className="font-semibold">
        Order NFC stickers
      </h2>
      <p className="mt-1 text-sm text-charcoal/60">
        One for each table tent and welcome sign, plus a few spares in case one doesn&apos;t
        write. Packs are cheap and any NTAG213 or NTAG215 sticker works.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {NFC_STORE_LINKS.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 border border-charcoal/25 px-4 py-2.5 text-sm transition hover:border-charcoal/60"
          >
            <span className="font-medium text-charcoal">{link.label} →</span>
            <span className="mt-0.5 block text-xs text-charcoal/60">{link.detail}</span>
          </a>
        ))}
      </div>
      <p className="mt-2 text-xs text-charcoal/50">
        Opens {NFC_STORE_NAME} in a new tab.{' '}
        {NFC_STORE_AFFILIATE
          ? 'SharePix may earn a small commission if you buy through this link.'
          : 'SharePix doesn’t sell these and isn’t paid for the link.'}
      </p>
    </section>
  );
}
