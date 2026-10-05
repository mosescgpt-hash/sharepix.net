import { useEffect } from 'react';
import Layout from '@/components/Layout';
import PricingCards from '@/components/PricingCards';
import {
  CORPORATE_PLAN,
  TRIAL_GALLERY_DAYS,
  TRIAL_UPLOAD_WINDOW_DAYS,
  VIDEO_GB_INCLUDED,
} from '@/lib/pricing';
import { FAIR_USE_PHOTO_CEILING } from '@/lib/fairUse';
import { trackEvent } from '@/lib/trackEvent';
import { pricingJsonLd } from '@/lib/seo';

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
    q: 'Is there a limit on how many photos each guest can share?',
    a: 'No. Some event apps give each guest a roll of film — 24 or 36 shots and then they are done. SharePix has no per-guest limit: every guest can share every photo they took, and the fair-use ceiling below is for the whole event, never for one person.',
  },
  {
    q: 'Is "unlimited photos" really unlimited?',
    a: `Unlimited, with one number we would rather tell you up front: a fair-use ceiling of ${FAIR_USE_PHOTO_CEILING.toLocaleString('en-US')} photos per event. A 300-guest wedding usually lands around 2,000. If your event gets near the ceiling, a button on your dashboard asks us for more room and we raise it free — your guests keep uploading the whole time, it never pauses mid-reception. What fair use rules out is automated uploads, bulk archival or backup use, and abusive activity.`,
  },
  {
    q: 'What about video?',
    a: `${VIDEO_GB_INCLUDED} GB in total, with each file up to 250 MB — roughly three hours at 1080p. Video is not unlimited and we would rather say so than bury it: a video streams at full size every time somebody watches it, so it costs differently from a photo. It is a budget rather than a number of clips because thirty short clips and thirty long ones are not the same thing, and counting them charged the short-clip host for space they never used. If ${VIDEO_GB_INCLUDED} GB is not enough for your event, get in touch.`,
  },
  {
    q: 'Is my gallery private?',
    a: 'It is private from search: it never appears in Google or any other search engine, and nobody can stumble onto it. It is unlisted rather than locked, though — anyone you give the QR code or link to can open the gallery and add photos, and it is not password-protected. Share it with the people you want there, and remember that a photo of your table sign works just like the link.',
  },
  {
    q: 'What is the free event?',
    a: `A real event, not a demo — your own QR code, your own guests, your own gallery. It holds up to 50 photos and 1 video, guests can upload for ${TRIAL_UPLOAD_WINDOW_DAYS} days, and the gallery stays up for ${TRIAL_GALLERY_DAYS} days after that. One per account, and a limited number are handed out each day, so it is there to try SharePix at something small before you pay for something that matters.`,
  },
  {
    q: 'How does Corporate work?',
    a: `${CORPORATE_PLAN.priceLabel}, billed monthly through Stripe. It includes ${CORPORATE_PLAN.includedEvents} new events every calendar month, and as many can run at once as you like. The count resets on the 1st; unused events do not roll over. If you need more in a month, each extra event is $${CORPORATE_PLAN.extraEventPrice}, paid once when you create it. Cancel any time and you keep 30 days to download everything.`,
  },
];

export default function PricingPage() {
  // The Believe stage. Reaching pricing is the strongest signal short of
  // starting an event, and it is the one the funnel could never see before.
  useEffect(() => {
    trackEvent('pricing_view');
  }, []);

  return (
    <Layout title="Pricing" width="bleed" structuredData={pricingJsonLd()}>
      {/* One centred column, the width of the cards, rather than a wide
          container with the cards pinned to its left and the right third of
          the screen left empty. */}
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-3xl">
          <p className="spx-eyebrow">Simple pricing</p>
          <h1 className="mt-3">
            <span className="spx-display block">One event. One price.</span>
            <span className="spx-display-serif block">Every memory.</span>
          </h1>
          <p className="spx-body mt-5 max-w-lg">
            Priced per event rather than per guest or per photo. Everyone you invite uploads
            for free, nothing renews, and there is no bigger plan to be upsold to later.
          </p>

          <div className="mt-12">
            <PricingCards />
          </div>

          <p className="mt-8 text-sm text-charcoal/60">
            Unlimited guests · Unlimited photos under fair use · No per-guest limit · Full-resolution memories · Private from search, shared by QR code
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
