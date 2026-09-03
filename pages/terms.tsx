import Layout from '@/components/Layout';
import { BUSINESS_ADDRESS, LEGAL_ENTITY } from '@/lib/businessInfo';

// Update this whenever the terms change.
const LAST_UPDATED = 'July 28, 2026';
const CONTACT_EMAIL = 'support@sharepix.net';
// The U.S. state whose law governs these terms — set to where Calvin Solutions
// LLC is registered.
const GOVERNING_STATE = 'the State in which Calvin Solutions LLC is organized';

export default function TermsPage() {
  return (
    <Layout title="Terms of Service">
      <section className="mx-auto max-w-3xl py-12 sm:py-16">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Terms of Service</h1>
        <p className="mt-3 text-sm text-muted">Last updated: {LAST_UPDATED}</p>

        <div className="sp-card mt-10 space-y-9 p-7 leading-relaxed text-ink/80 sm:p-10 [&_a]:text-accent [&_a]:underline [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
          <div>
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) are a legal agreement between you
              and <strong>SharePix, a product of Calvin Solutions LLC</strong>{' '}
              (&ldquo;SharePix,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;),
              governing your use of the event photo-sharing service at{' '}
              <a href="https://www.sharepix.net">sharepix.net</a>{' '}(the &ldquo;Service&rdquo;). By
              creating an account, creating or joining an event, or uploading content, you agree
              to these Terms. If you do not agree, do not use the Service.
            </p>
            <p>
              Please also read our{' '}
              <a href="/privacy">Privacy Policy</a>, which explains how we handle information.
            </p>
          </div>

          <div>
            <h2>1. Who may use the Service</h2>
            <p>
              You must be at least 18 years old, or the age of majority where you live, to create
              an account and host events. Guests of any age may be photographed and may upload
              content only with the permission and supervision of a responsible adult. By using
              the Service you represent that you can form a binding contract with us.
            </p>
          </div>

          <div>
            <h2>2. Accounts (hosts)</h2>
            <ul>
              <li>You are responsible for the accuracy of your account information.</li>
              <li>
                You are responsible for keeping your login credentials secure and for all activity
                under your account. We recommend enabling multi-factor authentication.
              </li>
              <li>Notify us promptly of any unauthorized use of your account.</li>
            </ul>
          </div>

          <div>
            <h2>3. Your content and ownership</h2>
            <p>
              &ldquo;Your Content&rdquo; means the photos, videos, event names, and other material
              you or your guests upload. <strong>You keep all ownership of Your Content.</strong>{' '}
              We do not claim ownership of it.
            </p>
            <p>
              To operate the Service, you grant SharePix a limited, non-exclusive, worldwide,
              royalty-free license to host, store, back up, reproduce, process, adapt (for example,
              to create thumbnails and previews), transmit, and display Your Content{' '}
              <strong>solely for the purpose of providing and maintaining the Service</strong> to
              you and the people you allow to access your event. This license exists only while
              Your Content is on the Service and for a short period afterward needed to complete
              removal and routine backups. We do not sell Your Content and do not use it for
              advertising.
            </p>
          </div>

          <div>
            <h2>4. Your responsibilities for content</h2>
            <p>By uploading Your Content, you represent and warrant that:</p>
            <ul>
              <li>
                You have all rights, consents, and permissions needed to upload it and to grant the
                license above — including, where required, the permission of people who appear in
                photos or videos.
              </li>
              <li>
                Your Content does not infringe anyone&rsquo;s intellectual-property, privacy, or
                publicity rights, and does not violate any law.
              </li>
              <li>
                As a host, you are responsible for your event and for how your guests use it,
                including obtaining any notices or consents appropriate for your event.
              </li>
            </ul>
          </div>

          <div>
            <h2>5. Acceptable use</h2>
            <p>You agree not to use the Service to upload, share, or do anything that:</p>
            <ul>
              <li>is unlawful, harassing, defamatory, or infringing;</li>
              <li>
                contains sexually explicit material involving minors, or any content that exploits
                or endangers a minor;
              </li>
              <li>violates the privacy or rights of others;</li>
              <li>contains malware, or attempts to breach or overload the Service or its security;</li>
              <li>
                attempts to access events, galleries, or data you are not authorized to access.
              </li>
            </ul>
            <p>
              We may remove content or suspend access that we reasonably believe violates these
              Terms, and hosts may moderate and remove content within their own events.
            </p>
          </div>

          <div>
            <h2>6. Plans, payments, and access windows</h2>
            <ul>
              <li>
                Paid plans are billed through our payment processor, <a href="https://stripe.com">Stripe</a>.
                Card details are entered on Stripe and are never stored by SharePix.
              </li>
              <li>
                Every event includes a <strong>30-day upload window</strong>{' '}(extendable in
                30-day blocks for half the plan price). After it closes, guests keep limited,
                reduced-resolution viewing for a while, and the host keeps full access and
                downloads for the plan&rsquo;s retention period (Starter ~3 weeks, Standard 3
                months, Premium 1 year). After retention, photos move to a private archive for up
                to 90 days and are then permanently deleted. Download what you want to keep before
                your retention period ends. Full details are on our{' '}
                <a href="/pricing">pricing page</a>.
              </li>
              <li>
                Prices and plan features may change; changes apply to future purchases. Except where
                required by law, payments are non-refundable. If you believe you were charged in
                error, contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
              </li>
            </ul>
          </div>

          <div>
            <h2>7. Availability and changes to the Service</h2>
            <p>
              We work to keep the Service available and reliable, but we provide it on an
              as-available basis and may modify, suspend, or discontinue features. We are not
              responsible for content that is lost because you did not download it before your
              event&rsquo;s retention period ended.
            </p>
          </div>

          <div>
            <h2>8. Termination</h2>
            <p>
              You may stop using the Service and delete your events at any time. We may suspend or
              terminate access if you violate these Terms or to protect the Service or its users.
              Sections that by their nature should survive termination (such as content licenses
              already exercised, disclaimers, and limitations of liability) will survive.
            </p>
          </div>

          <div>
            <h2>9. Copyright and DMCA</h2>
            <p>
              SharePix hosts photos and videos uploaded by hosts and their guests. We respond to
              notices of claimed copyright infringement under the Digital Millennium Copyright
              Act. Our <a href="/dmca">Copyright and DMCA Policy</a>{' '}sets out our designated
              agent&rsquo;s contact details and the process for sending a notice or a
              counter-notification.
            </p>
            <p>
              We have adopted and reasonably implement a policy of terminating, in appropriate
              circumstances, the accounts of hosts who are repeat infringers.
            </p>
          </div>

          <div>
            <h2>10. Disclaimers</h2>
            <p>
              THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT
              WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT
              WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT CONTENT
              WILL NOT BE LOST.
            </p>
          </div>

          <div>
            <h2>11. Limitation of liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, SHAREPIX AND CALVIN SOLUTIONS LLC WILL NOT BE
              LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR
              FOR ANY LOSS OF DATA, CONTENT, PROFITS, OR GOODWILL. OUR TOTAL LIABILITY FOR ANY CLAIM
              RELATING TO THE SERVICE WILL NOT EXCEED THE AMOUNT YOU PAID US FOR THE EVENT GIVING
              RISE TO THE CLAIM IN THE 12 MONTHS BEFORE IT AROSE. Some jurisdictions do not allow
              certain limitations, so some of the above may not apply to you.
            </p>
          </div>

          <div>
            <h2>12. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless SharePix and Calvin Solutions LLC from claims,
              damages, and expenses (including reasonable legal fees) arising out of Your Content,
              your use of the Service, or your violation of these Terms or the rights of others.
            </p>
          </div>

          <div>
            <h2>13. Governing law</h2>
            <p>
              These Terms are governed by the laws of {GOVERNING_STATE}, without regard to its
              conflict-of-laws rules. You agree to the exclusive jurisdiction of the state and
              federal courts located there for any dispute not subject to arbitration or
              small-claims court.
            </p>
          </div>

          <div>
            <h2>14. Changes to these Terms</h2>
            <p>
              We may update these Terms from time to time. When we do, we will revise the
              &ldquo;Last updated&rdquo; date above, and for significant changes we will provide a
              more prominent notice. Your continued use of the Service after an update means you
              accept the revised Terms.
            </p>
          </div>

          <div>
            <h2>15. Contact</h2>
            <p>
              Questions about these Terms? Contact us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, or write to us:
            </p>
            {/* The postal address comes from lib/businessInfo, the same place
                the DMCA page reads it, so the two can never disagree. */}
            <p className="mt-3 whitespace-pre-line text-sm">{BUSINESS_ADDRESS}</p>
            <p className="text-sm text-muted">
              Copyright notices go to our designated agent instead — see our{' '}
              <a href="/dmca">Copyright and DMCA Policy</a>.
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
