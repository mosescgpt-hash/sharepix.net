import { useMemo, useState } from 'react';
import { requestUploadReminder } from '@/lib/uploadReminders/api';
import { isValidEmail, normalizeEmail, reminderOffer, reminderSchedule, zoneFor } from '@/lib/uploadReminders/rules';
import type { QREvent } from '@/lib/types';

const DISMISS_KEY = (eventId: string) => `spx-reminder-optin:${eventId}`;

function remembered(eventId: string): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY(eventId)) === '1';
  } catch {
    return false;
  }
}

function remember(eventId: string) {
  try {
    window.sessionStorage.setItem(DISMISS_KEY(eventId), '1');
  } catch {
    // Private mode: the card may show again after the next batch. Harmless.
  }
}

/**
 * "Want a reminder tomorrow to add more photos?" — shown once, after a guest's
 * first successful upload, and only when the host turned reminders on.
 *
 * It sits below the upload form and never in its way: the photos are already
 * uploaded when it appears, and "No thanks" is one tap. Whether a reminder is
 * still on offer, and which one, is re-decided by the server.
 */
export default function ReminderOptInCard({ event }: { event: QREvent }) {
  const offer = useMemo(() => reminderOffer(event, Date.now()), [event]);
  const twoEmails = useMemo(
    () => offer?.kind === 'first' && !!reminderSchedule(event, Date.now()).second,
    [event, offer],
  );
  const [hidden, setHidden] = useState(() => remembered(event.id));
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  if (!offer || hidden) return null;

  const closesOn = offer.closesAt
    ? offer.closesAt.toLocaleDateString('en-US', { timeZone: zoneFor(event), month: 'long', day: 'numeric' })
    : null;
  const question =
    offer.kind === 'first'
      ? 'Want a reminder tomorrow to add more photos?'
      : `Want a reminder before uploads close${closesOn ? ` on ${closesOn}` : ''}?`;
  const consent =
    twoEmails
      ? 'We’ll use your email only to remind you about this event: tomorrow morning, and once more before uploads close. The host can’t see it, and we delete it 30 days after uploads close. Every email has an unsubscribe link.'
      : 'We’ll use your email only to remind you once about this event. The host can’t see it, and we delete it 30 days after uploads close. The email has an unsubscribe link.';

  const dismiss = () => {
    remember(event.id);
    setHidden(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeEmail(email);
    if (!isValidEmail(clean)) {
      setMessage('That doesn’t look like an email address.');
      return;
    }
    setState('sending');
    setMessage(null);
    const result = await requestUploadReminder(event.id, clean);
    if (result.ok) {
      remember(event.id);
      setState('done');
    } else {
      setState('idle');
    }
    setMessage(result.message);
  };

  if (state === 'done') {
    return (
      <div className="spx-card mt-6 p-5" role="status">
        <p className="text-sm font-medium text-charcoal">{message}</p>
      </div>
    );
  }

  return (
    <form className="spx-card mt-6 p-5" onSubmit={submit} noValidate>
      <label htmlFor="reminder-email" className="block font-sans text-base font-semibold text-charcoal">
        {question}
      </label>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="reminder-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          className="spx-input min-w-0 flex-1"
          aria-describedby="reminder-consent"
        />
        <button type="submit" disabled={state === 'sending'} className="spx-btn-ink disabled:opacity-50">
          {state === 'sending' ? 'Saving…' : 'Remind me'}
        </button>
      </div>
      {message ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {message}
        </p>
      ) : null}
      <p id="reminder-consent" className="mt-3 text-xs text-charcoal/60">
        {consent}
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="mt-3 text-sm font-medium text-charcoal/70 underline underline-offset-4"
      >
        No thanks
      </button>
    </form>
  );
}
