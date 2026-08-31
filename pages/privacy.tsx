import Layout from '@/components/Layout';

// Last updated date shown at the top of the policy. Update this whenever the
// policy text changes.
const LAST_UPDATED = 'August 31, 2026';
const CONTACT_EMAIL = 'privacy@sharepix.net';

export default function PrivacyPage() {
  return (
    <Layout title="Privacy Policy">
      <section className="mx-auto max-w-3xl py-10">
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink/60">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-ink/80 [&_a]:text-accent [&_a]:underline [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink [&_h3]:font-semibold [&_h3]:text-ink [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
          <div>
            <p>
              SharePix, a product of Calvin Solutions LLC (&ldquo;SharePix,&rdquo;
              &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;), provides an event
              photo-sharing service at{' '}
              <a href="https://www.sharepix.net">sharepix.net</a> (the
              &ldquo;Service&rdquo;). This Privacy Policy explains what information we
              collect, how we use and share it, and the choices you have. By using the
              Service, you agree to this Policy.
            </p>
            <p>
              We designed SharePix so guests can contribute photos without creating an
              account or handing over personal details. We collect only what we need to
              run events, and we never sell your information.
            </p>
          </div>

          <div>
            <h2>Who this Policy covers</h2>
            <ul>
              <li>
                <strong>Hosts</strong> — people who create an account and set up an event.
              </li>
              <li>
                <strong>Guests</strong> — people who scan an event&rsquo;s QR code or link to
                view a gallery or upload photos. Guests do not need an account.
              </li>
            </ul>
          </div>

          <div>
            <h2>Information we collect</h2>

            <h3>From hosts (account holders)</h3>
            <ul>
              <li>
                <strong>Account details:</strong> your email address and a password, managed
                through Amazon Cognito. If you enable multi-factor authentication (MFA), we
                store the setting needed to prompt you for a one-time code.
              </li>
              <li>
                <strong>Event details:</strong> event name, date, plan, event/access codes,
                and settings you configure.
              </li>
            </ul>

            <h3>From guests</h3>
            <ul>
              <li>
                <strong>Photos and videos</strong> you choose to upload to an event gallery.
              </li>
              <li>
                <strong>An optional name or nickname</strong> you may add so the host knows who
                contributed (for example, &ldquo;Aunt Maya&rdquo;). This is optional and stored
                on your own device to save you retyping it; it is attached to photos you upload.
              </li>
            </ul>
            <p>
              To upload photos or view a gallery, guests are not asked for an email address,
              phone number, or account. That changes only if a guest chooses to order prints,
              which is optional and separate &mdash; see <strong>If you order prints</strong>{' '}
              below. Please note that photos and videos can themselves contain personal
              information (faces, locations, or details visible in the image, and any metadata
              the file carries).
            </p>

            <h3>If you order prints</h3>
            <p>
              Ordering a physical print is optional. Uploading photos and browsing a gallery
              never require it, and nothing about ordering is a condition of taking part in an
              event. If you do order, we need what any purchase and delivery requires: your
              name, shipping address, and an email address for the receipt and delivery
              updates. You enter these at Stripe&rsquo;s checkout, not on SharePix.
            </p>
            <p>
              We keep a record of the order &mdash; the items, the shipping name and address,
              the email address, and the order status &mdash; so we can answer questions about
              it, resolve delivery problems, and meet accounting obligations. As with everything
              else in this Policy, <strong>we do not sell this information</strong>. It is used
              to fulfil your order and support it, and shared only with the providers named
              below who carry that out.
            </p>

            <h3>Payment information</h3>
            <p>
              Payments are processed by <a href="https://stripe.com">Stripe</a> through its
              hosted checkout. Your full card number and security code are entered on
              Stripe&rsquo;s pages and are <strong>never sent to or stored by SharePix</strong>.
              We receive a confirmation from Stripe that includes limited details such as the
              amount, currency, plan, payment status, and the email you provided at checkout.
            </p>

            <h3>Information collected automatically</h3>
            <p>
              Like most online services, our infrastructure providers automatically log
              technical information such as IP address, browser type, and request timestamps to
              operate the Service, keep it secure, and diagnose problems. We use essential
              browser storage (for example, to keep you signed in and remember your uploader
              nickname). We do not use advertising or cross-site tracking cookies.
            </p>
          </div>

          <div>
            <h2>How we use information</h2>
            <ul>
              <li>To create and operate events and galleries.</li>
              <li>To let guests upload photos and hosts view, moderate, and download them.</li>
              <li>To authenticate hosts and keep accounts secure.</li>
              <li>To process payments and provide receipts through Stripe.</li>
              <li>To detect, prevent, and respond to abuse, fraud, and security issues.</li>
              <li>To respond to your requests and provide support.</li>
              <li>To comply with legal obligations.</li>
            </ul>
          </div>

          <div>
            <h2>Photos and event content</h2>
            <p>
              Photos and videos uploaded to an event are visible to the event&rsquo;s host and
              to others who have access to that event (for example, guests with the link or QR
              code, according to the event&rsquo;s settings). Hosts can view, download, moderate,
              and delete content in their events. If you are a guest and want a photo you
              uploaded removed, ask the event host, or contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </div>

          <div>
            <h2>How we share information</h2>
            <p>We do not sell your personal information. We share information only:</p>
            <ul>
              <li>
                <strong>With service providers</strong> that run the Service on our behalf,
                namely <strong>Amazon Web Services</strong> (hosting, storage, databases, and
                account management), <strong>Stripe</strong> (payment processing), and{' '}
                <strong>Prodigi</strong> (print manufacturing and shipping). Prodigi is
                involved only when you order a print: it receives the shipping name and
                address for that order and retrieves the photo you chose, in order to make and
                send it. These providers handle data under their own privacy and security
                commitments, and are given only what they need to perform their part.
              </li>
              <li>
                <strong>Within an event</strong> — content and any nickname you add are shared
                with the host and others who have access to that event, as described above.
              </li>
              <li>
                <strong>For legal reasons</strong> — if required by law, or to protect the
                rights, safety, and security of our users, the public, or SharePix.
              </li>
              <li>
                <strong>In a business transfer</strong> — if SharePix is involved in a merger,
                acquisition, or sale of assets, information may be transferred as part of that
                transaction.
              </li>
            </ul>
          </div>

          <div>
            <h2>Where your information is stored</h2>
            <p>
              SharePix is hosted on Amazon Web Services in the United States. If you access the
              Service from outside the United States, you understand that your information will
              be processed in the United States, where privacy laws may differ from those in
              your country.
            </p>
          </div>

          <div>
            <h2>How long we keep photos and events</h2>
            <p>Each event moves through a lifecycle:</p>
            <ul>
              <li>
                <strong>Upload window — 30 days</strong> from creation (extendable in 30-day
                blocks). Guests can upload and view the photos.
              </li>
              <li>
                <strong>After the window closes,</strong> guests can view reduced-resolution
                photos for a limited time (about 3 weeks on Starter, 30 days on Standard and
                Premium), then guest access ends.
              </li>
              <li>
                <strong>Host retention</strong> — the host keeps full access and downloads for a
                period set by the plan (about 3 weeks on Starter, 3 months on Standard, 1 year on
                Premium) measured from when the upload window closes.
              </li>
              <li>
                <strong>Archive</strong> — after retention, photos move to a private archive that
                hosts can&rsquo;t see, kept for up to 90 days (a global administrator can restore
                them on request), and are then permanently deleted.
              </li>
            </ul>
            <p>
              Hosts can delete their photos and events at any time. We may retain limited records
              (such as payment confirmations) as required for accounting, legal, or
              fraud-prevention purposes.
            </p>
          </div>

          <div>
            <h2>Security</h2>
            <p>
              We take reasonable measures to protect your information, including encrypted
              connections, scoped access controls, optional multi-factor authentication for
              hosts, and keeping card data with Stripe rather than on our systems. No method of
              transmission or storage is completely secure, so we cannot guarantee absolute
              security.
            </p>
          </div>

          <div>
            <h2>Your choices and rights</h2>
            <p>
              Depending on where you live, you may have rights to access, correct, delete, or
              obtain a copy of your personal information, or to object to or restrict certain
              processing. To make a request, email us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will respond as required
              by applicable law. We do not sell personal information or share it for
              cross-context behavioral advertising.
            </p>
            <ul>
              <li>Hosts can update account details and delete events and photos at any time.</li>
              <li>
                Guests can ask the host, or contact us, to remove content they uploaded.
              </li>
            </ul>
          </div>

          <div>
            <h2>Children&rsquo;s privacy</h2>
            <p>
              The Service is not directed to children under 13, and we do not knowingly collect
              personal information from them. Events often include photos of children uploaded by
              adults (hosts and guests); the host is responsible for having the right to collect
              and share that content. If you believe a child has provided us personal information
              directly, contact us and we will delete it.
            </p>
          </div>

          <div>
            <h2>Changes to this Policy</h2>
            <p>
              We may update this Policy from time to time. When we do, we will revise the
              &ldquo;Last updated&rdquo; date above, and for significant changes we will provide a
              more prominent notice. Your continued use of the Service after an update means you
              accept the revised Policy.
            </p>
          </div>

          <div>
            <h2>Contact us</h2>
            <p>
              If you have questions about this Policy or your information, contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
