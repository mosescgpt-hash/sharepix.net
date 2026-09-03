import Layout from '@/components/Layout';
import { DMCA_AGENT, DMCA_RENEWAL_DUE, LEGAL_ENTITY, SUPPORT_EMAIL } from '@/lib/businessInfo';

// Update this whenever the policy changes.
const LAST_UPDATED = 'September 2, 2026';

/**
 * The agent and the renewal date come from lib/businessInfo, which is the one
 * place the business address is written. Safe harbour under 17 U.S.C. § 512(c)
 * requires these details to be BOTH filed with the Copyright Office AND
 * published here, and details that disagree with the registration are worse
 * than none — a notice sent to the published address may never reach us, and
 * the mismatch undermines the designation itself.
 *
 * docs/business-records.md lists the external records that carry the same
 * address and cannot be updated from this repository.
 */
const AGENT = DMCA_AGENT;
const RENEWAL_DUE = DMCA_RENEWAL_DUE;

export default function DmcaPage() {
  return (
    <Layout title="Copyright & DMCA">
      <section className="mx-auto max-w-3xl py-12 sm:py-16">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">
          Copyright and DMCA Policy
        </h1>
        <p className="mt-3 text-sm text-muted">Last updated: {LAST_UPDATED}</p>

        <div className="sp-card mt-10 space-y-9 p-7 leading-relaxed text-ink/80 sm:p-10 [&_a]:text-accent [&_a]:underline [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink [&_li]:mt-1 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
          <div>
            <p>
              SharePix, a product of <strong>{LEGAL_ENTITY}</strong>, hosts photos and
              videos uploaded by the guests and hosts of events. We respect copyright and
              respond to notices of claimed infringement under the Digital Millennium
              Copyright Act (&ldquo;DMCA&rdquo;), 17 U.S.C. § 512.
            </p>
            <p>
              If you believe material on SharePix infringes a copyright you own or are
              authorised to act for, you can send us a notice using the process below and we
              will act on it promptly.
            </p>
          </div>

          <div>
            <h2>Designated agent</h2>
            <p>
              We have designated the following agent to receive notices of claimed
              infringement, and have registered that designation with the U.S. Copyright
              Office:
            </p>
            <div className="mt-4 rounded-xl border border-line bg-smoke p-5 text-sm not-italic">
              <p className="mt-0 font-semibold text-ink">{AGENT.name}</p>
              {/* BUSINESS_ADDRESS already opens with the legal entity, so
                  printing AGENT.organization above it repeated the company
                  name on consecutive lines. */}
              <p className="mt-0 whitespace-pre-line">{AGENT.address}</p>
              <p className="mt-0">Telephone: {AGENT.phone}</p>
              <p className="mt-0">
                Email: <a href={`mailto:${AGENT.email}`}>{AGENT.email}</a>
              </p>
            </div>
            <p className="text-sm text-muted">
              This address is for copyright notices only. For anything else, please use{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
          </div>

          <div>
            <h2>Sending a notice of claimed infringement</h2>
            <p>
              To be effective under the DMCA, your written notice must include substantially
              all of the following:
            </p>
            <ol>
              <li>
                A physical or electronic signature of a person authorised to act on behalf of
                the owner of the exclusive right that is allegedly infringed.
              </li>
              <li>
                Identification of the copyrighted work claimed to have been infringed, or, if
                several works at a single site are covered by one notice, a representative list
                of them.
              </li>
              <li>
                Identification of the material that is claimed to be infringing and that is to
                be removed, with information reasonably sufficient for us to locate it. A
                direct link to the photo or the gallery, plus a description of which image, is
                the most useful thing you can give us.
              </li>
              <li>
                Information reasonably sufficient for us to contact you: your name, address,
                telephone number, and email address.
              </li>
              <li>
                A statement that you have a good-faith belief that use of the material in the
                manner complained of is not authorised by the copyright owner, its agent, or
                the law.
              </li>
              <li>
                A statement that the information in the notice is accurate, and{' '}
                <em>under penalty of perjury</em>, that you are authorised to act on behalf of
                the owner of the exclusive right that is allegedly infringed.
              </li>
            </ol>
          </div>

          <div>
            <h2>What we do when we receive a notice</h2>
            <p>
              On receiving a notice that substantially complies with the requirements above, we
              will remove or disable access to the material expeditiously. We will make a
              reasonable effort to notify the host of the event the material was uploaded to,
              and to give them a copy of the notice and information about filing a
              counter-notification.
            </p>
            <p>
              Removing a photo does not delete the event or affect other photos in it.
            </p>
          </div>

          <div>
            <h2>Counter-notification</h2>
            <p>
              If you believe your material was removed or disabled as a result of mistake or
              misidentification, you may send our designated agent a counter-notification
              containing substantially all of the following:
            </p>
            <ol>
              <li>Your physical or electronic signature.</li>
              <li>
                Identification of the material that was removed or disabled, and the location
                at which it appeared before it was removed or disabled.
              </li>
              <li>
                A statement <em>under penalty of perjury</em> that you have a good-faith belief
                that the material was removed or disabled as a result of mistake or
                misidentification.
              </li>
              <li>
                Your name, address, and telephone number, and a statement that you consent to
                the jurisdiction of the Federal District Court for the judicial district in
                which your address is located — or, if your address is outside the United
                States, for any judicial district in which we may be found — and that you will
                accept service of process from the person who gave the original notice or an
                agent of that person.
              </li>
            </ol>
            <p>
              If we receive a valid counter-notification, we will forward it to the person who
              sent the original notice. Unless that person notifies us that they have filed a
              court action seeking to restrain the allegedly infringing activity, we may
              restore the material in not less than 10 and not more than 14 business days after
              we receive the counter-notification.
            </p>
          </div>

          <div>
            <h2>Repeat infringers</h2>
            <p>
              We have adopted and reasonably implement a policy of terminating, in appropriate
              circumstances, the accounts of hosts who are repeat infringers. Depending on the
              circumstances, we may also remove an event, disable a gallery, or refuse to
              provide the Service to a person who repeatedly uploads infringing material.
            </p>
          </div>

          <div>
            <h2>Misrepresentations</h2>
            <p>
              Under 17 U.S.C. § 512(f), any person who knowingly materially misrepresents that
              material is infringing — or that it was removed or disabled by mistake or
              misidentification — may be liable for damages, including costs and attorneys&rsquo;
              fees. Please consider whether the use might be permitted, for example as fair
              use, before sending a notice.
            </p>
          </div>

          <div>
            <h2>Related policies</h2>
            <p>
              See also our <a href="/terms">Terms of Service</a> and{' '}
              <a href="/privacy">Privacy Policy</a>. If you want a photo of yourself removed for
              reasons other than copyright — for example, you did not want to be photographed —
              contact the event&rsquo;s host, or email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will help.
            </p>
            {/* Not a legal requirement, but the request we are most likely to
                actually receive at an event. Sending someone to a copyright
                process for a privacy problem helps nobody. */}
          </div>
        </div>

        <p className="mt-10 text-xs text-muted">
          Our designated-agent registration with the U.S. Copyright Office is due for renewal
          by {RENEWAL_DUE}.
        </p>
      </section>
    </Layout>
  );
}
