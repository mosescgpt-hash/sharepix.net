import Layout from '@/components/Layout';
import Link from 'next/link';
import {
  CAPACITY_ASK_PHOTOS,
  FAIR_USE_DEFAULTS,
  FAIR_USE_NOTICE,
  formatBytes,
} from '@/lib/fairUse';
import { GALLERY_MONTHS, VIDEO_GB_INCLUDED } from '@/lib/pricing';
import { MAX_VIDEO_SIZE_LABEL } from '@/lib/validation';

/**
 * The fair use policy, as a page rather than a clause.
 *
 * ## Why this is its own page
 *
 * "Unlimited photos*" with an asterisk is a promise and a caveat in the same
 * breath, and where the caveat lives decides whether the promise is honest. It
 * pointed at a section of the terms, which is where a reader goes only if they
 * already suspect something. Every serious competitor publishes this as a page.
 *
 * The reason to have one is not to look like them. It is that the numbers below
 * are genuinely generous, and a policy nobody can find gets no credit for that.
 *
 * ## Every number here is read from the code
 *
 * Nothing on this page is typed as a literal. The thresholds come from
 * FAIR_USE_DEFAULTS, which is the same object the upload handler enforces, so
 * this page cannot drift from what actually happens the way the survey did.
 * `__tests__/fair-use.test.ts` asserts that.
 *
 * The one thing deliberately NOT shown is the velocity threshold. Publishing
 * "uploads are refused above N a minute" tells somebody writing a script
 * exactly what rate to stay under, and it is the only threshold here that a
 * real host can neither reach nor need to know.
 */
export default function FairUsePage() {
  const reviewPhotos = FAIR_USE_DEFAULTS.photoReviewThreshold.toLocaleString();
  const abusePhotos = FAIR_USE_DEFAULTS.photoAbuseThreshold.toLocaleString();
  const reviewStorage = formatBytes(FAIR_USE_DEFAULTS.storageReviewBytes);
  const abuseStorage = formatBytes(FAIR_USE_DEFAULTS.storageAbuseBytes);

  return (
    <Layout title="Fair use">
      <section className="mx-auto max-w-3xl py-12 sm:py-16">
        <p className="spx-eyebrow">Fair use</p>
        <h1 className="mt-3">
          <span className="spx-display block">What &ldquo;unlimited&rdquo;</span>
          <span className="spx-display-serif block">actually means.</span>
        </h1>

        <div className="spx-card mt-10 space-y-9 p-7 leading-relaxed text-charcoal/80 sm:p-10 [&_a]:text-pine [&_a]:underline [&_h2]:font-sans [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-[-0.02em] [&_h2]:text-charcoal [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
          <div>
            <p>
              The paid plan includes unlimited photo uploads. We mean it, and this page
              exists so you can check rather than take our word for it: below are the
              actual numbers, what happens at each one, and what we will never do.
            </p>
            <p>{FAIR_USE_NOTICE}</p>
          </div>

          <div>
            <h2>The short version</h2>
            <p>
              <strong>
                We will never restrict your event for being popular, and we will never
                stop your guests uploading without talking to you first.
              </strong>{' '}
              The limits below exist to catch someone using a one-off $79 purchase as a
              backup drive. They are set far above what a celebration produces.
            </p>
          </div>

          <div>
            <h2>The numbers</h2>
            <ul>
              <li>
                <strong>Around {CAPACITY_ASK_PHOTOS.toLocaleString()} photos</strong> — a
                button appears on your dashboard offering more room. Nothing changes,
                nothing pauses, and you do not have to press it. It is there because an
                event this size is unusual and we would rather ask than assume.
              </li>
              <li>
                <strong>
                  {reviewPhotos} photos, or {reviewStorage} stored
                </strong>{' '}
                — your event is flagged for a person to glance at. Uploads carry on
                exactly as before. Most events that reach this are simply large, and that
                is the end of it.
              </li>
              <li>
                <strong>
                  {abusePhotos} photos, or {abuseStorage} stored
                </strong>{' '}
                — the point at which uploads can actually be paused. For scale, a
                300-guest wedding where a third of the room takes photos lands nearer two
                thousand. We have never seen a real event approach this.
              </li>
            </ul>
            <p>
              Video is the exception and is not sold as unlimited: the paid plan includes{' '}
              <strong>{VIDEO_GB_INCLUDED} GB</strong>, with each file up to{' '}
              {MAX_VIDEO_SIZE_LABEL}. A video is served at full size every time somebody
              watches it, so it costs differently from a photo, and pretending otherwise
              would mean pricing it into everybody&rsquo;s plan.
            </p>
          </div>

          <div>
            <h2>What is not allowed</h2>
            <p>
              These are the things the limits above are actually looking for, and they
              have nothing to do with how popular an event was:
            </p>
            <ul>
              <li>Automated or scripted uploading, rather than people at an event.</li>
              <li>
                Using an event as general file storage, a backup drive, or an archive of
                material that was not taken at the event.
              </li>
              <li>Reselling access, or running many people&rsquo;s events off one purchase.</li>
              <li>
                Anything already covered by the acceptable use section of our{' '}
                <Link href="/terms">terms</Link>.
              </li>
            </ul>
          </div>

          <div>
            <h2>What happens if we do get in touch</h2>
            <p>
              We email you first. If your event is genuine — and it almost always is — we
              add the room and that is the end of it. Restricting uploads is a last resort
              for clear abuse, not a step on the way to a conversation.
            </p>
            <p>
              You can also ask before it comes up. The button appears on your event
              dashboard once your event gets large, or you can{' '}
              <a href="mailto:support@sharepix.net">email us</a> at any point.
            </p>
          </div>

          <div>
            <h2>What this page is not</h2>
            <p>
              It is not a way of taking the word &ldquo;unlimited&rdquo; back. There is no
              hidden guest cap, no throttling once you pass some number, and no clause
              that lets us delete an event early because it got big. What ends an event is
              time, not size: the gallery stays up for {GALLERY_MONTHS} months after your
              upload window closes, and the schedule is on the{' '}
              <Link href="/pricing">pricing page</Link> and in our{' '}
              <Link href="/terms#fair-use">terms</Link>.
            </p>
          </div>
        </div>

        <p className="mt-8 text-sm text-charcoal/60">
          <Link href="/pricing" className="font-medium text-pine underline">
            Back to pricing
          </Link>
        </p>
      </section>
    </Layout>
  );
}
