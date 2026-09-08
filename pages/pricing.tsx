import Layout from '@/components/Layout';
import PricingCards from '@/components/PricingCards';
import { VIDEO_GB_INCLUDED } from '@/lib/pricing';

const faqs = [
  {
    q: 'Do guests pay anything?',
    a: 'No. Guests scan the QR code and upload for free — no account or app required.',
  },
  {
    q: 'How long is my event open?',
    a: 'Guests can upload for 60 days on every plan. You can extend the upload window by 30 more days anytime for half the plan price.',
  },
  {
    q: 'What happens after the upload window?',
    a: 'The gallery stays up for 12 months. Guests keep viewing it at reduced resolution, and as the host you keep full access and downloads for the whole 12 months. After that the photos are archived for 90 days and then permanently deleted, so download anything you want to keep before then. We email you before the gallery closes.',
  },
  {
    q: 'Can I moderate photos?',
    a: 'You can delete any photo on either plan. The paid plan adds approve-before-showing moderation, so nothing appears in the gallery until you have seen it.',
  },
  {
    q: 'Is "unlimited photos" really unlimited?',
    a: 'Yes, for a normal event — there is no number to count against and no cap to hit mid-reception. Unlimited covers normal event use: SharePix may step in on automated uploads, bulk archival or backup use, or activity that is abusive or extraordinarily large. If you are running a wedding, a conference or a school fundraiser, none of that applies to you.',
  },
  {
    q: 'What about video?',
    a: `${VIDEO_GB_INCLUDED} GB in total, with each file up to 250 MB — roughly three hours at 1080p. Video is not unlimited and we would rather say so than bury it: a video streams at full size every time somebody watches it, so it costs differently from a photo. It is a budget rather than a number of clips because thirty short clips and thirty long ones are not the same thing, and counting them charged the short-clip host for space they never used. If ${VIDEO_GB_INCLUDED} GB is not enough for your event, get in touch.`,
  },
  {
    q: 'Is my gallery private?',
    a: 'It is unlisted, which means it is reachable only through your event link or QR code and is never indexed by search engines. It is not password-protected, and we would rather be precise about that than call it private and let you assume something stronger. Share the link with the people you want in it.',
  },
  {
    q: 'What is the free event?',
    a: 'A real event, not a demo — your own QR code, your own guests, your own gallery. It holds up to 50 photos and 1 video, and the gallery stays up for 30 days after uploads close. One per account, so it is there to try SharePix at something small before you pay for something that matters.',
  },
];

export default function PricingPage() {
  return (
    <Layout title="Pricing" width="bleed">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-6xl">
          <p className="spx-eyebrow">Simple pricing</p>
          <h1 className="mt-3">
            <span className="spx-display block">One event. One price.</span>
            <span className="spx-display-serif block">Every memory.</span>
          </h1>
          <p className="spx-body mt-5 max-w-lg">
            Priced per event rather than per guest or per photo. Everyone you invite uploads
            for free, nothing renews, and there is no bigger plan to be upsold to later.
          </p>

          <div className="mt-12 max-w-3xl">
            <PricingCards />
          </div>

          <p className="mt-8 text-sm text-charcoal/60">
            Unlimited guests · Unlimited photos · Full-resolution memories · Private by default
          </p>
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
