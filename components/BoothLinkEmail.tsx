import { useEffect, useRef, useState } from 'react';
import { emailBoothLink } from '@/lib/api';
import { BOOTH_CONSENT_TEXT } from '@/lib/booth';

type Status = 'idle' | 'sending' | 'sent' | 'recent' | 'failed';

interface Props {
  galleryKey: string;
  /** Masked address already on file ("j***@gmail.com"), or null. */
  emailHint: string | null;
  /** They turned emails off: say nothing and send nothing. */
  emailsStopped: boolean;
}

const LATER =
  'Your photos appear on that page once the host approves them, and we email you again when they are ready.';

/**
 * The Stop screen's email line. With an address on file, their personal link
 * is emailed as soon as this appears and the address is shown masked. With
 * none, a small form (with the same consent line as sign-up) offers to email
 * it. Server-side limits (10 minutes apart, five in all, never after "stop
 * emails") keep this from being used to spam anyone; the secret key is the
 * only authorization, and the reply never names anyone else.
 */
export default function BoothLinkEmail({ galleryKey, emailHint, emailsStopped }: Props) {
  const [hint, setHint] = useState<string | null>(emailHint);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const auto = useRef(false);

  // Already on file: send straight away, once per time this screen shows.
  useEffect(() => {
    if (emailsStopped || !emailHint || auto.current) return;
    auto.current = true;
    setStatus('sending');
    emailBoothLink(galleryKey)
      .then((r) => {
        if (r.emailHint) setHint(r.emailHint);
        setMessage(r.message);
        setStatus(r.sent ? 'sent' : r.ok ? 'recent' : 'failed');
      })
      .catch(() => {
        setMessage('We could not send the email just now. Your link above still works.');
        setStatus('failed');
      });
  }, [galleryKey, emailHint, emailsStopped]);

  if (emailsStopped) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    setMessage('');
    try {
      const r = await emailBoothLink(galleryKey, { email: email.trim(), consent });
      if (r.emailHint) setHint(r.emailHint);
      setMessage(r.message);
      setStatus(r.sent ? 'sent' : r.ok ? 'recent' : 'failed');
    } catch {
      setMessage('We could not send the email just now. Your link above still works.');
      setStatus('failed');
    }
  }

  if (hint) {
    return (
      <section className="mt-5 border border-charcoal/15 bg-white p-4" aria-label="Email my link">
        <p className="text-base font-semibold" role="status">
          {status === 'sending'
            ? `Emailing your link to ${hint}…`
            : status === 'failed'
              ? message
              : `We'll email you at ${hint}`}
        </p>
        <p className="mt-1 text-sm text-charcoal/75">
          {status === 'failed' ? '' : `Your link is in that email. ${LATER}`}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5 border border-charcoal/15 bg-white p-4" aria-label="Email my link">
      <h3 className="text-base font-semibold">Want your link by email?</h3>
      <p className="mt-1 text-sm text-charcoal/75">{LATER}</p>
      <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
        <label className="block text-sm font-medium">
          Email
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            className="spx-input mt-1 min-h-[44px] w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
          />
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 shrink-0"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>{BOOTH_CONSENT_TEXT}</span>
        </label>
        <button
          type="submit"
          disabled={status === 'sending' || !email.trim() || !consent}
          className="spx-btn-ink inline-flex min-h-[48px] w-full items-center justify-center px-5 text-base font-semibold disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Email me my link'}
        </button>
        {status === 'failed' && message ? (
          <p className="text-sm font-medium" role="alert">
            {message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
