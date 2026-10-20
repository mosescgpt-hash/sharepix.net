import { useState } from 'react';
import Notice from '@/components/Notice';
import BoothAttendees from '@/components/BoothAttendees';
import { setEventBoothModeAsHost } from '@/lib/api';

/**
 * Booth mode on the host's Extras tab (docs/booth-mode.md). Included with
 * every event; the host switches it on here. Off, it explains itself in two
 * lines. On, it shows the sign-up links and attendees.
 */
export default function BoothModeCard({
  eventId,
  on,
  origin,
  onChanged,
}: {
  eventId: string;
  on: boolean;
  origin: string;
  onChanged: (on: boolean) => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    if (
      !next &&
      !window.confirm(
        'Turn booth mode off?\n\nThe sign-up page closes. People who already signed up keep their gallery links, and nothing is deleted.',
      )
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await setEventBoothModeAsHost(eventId, next);
      onChanged(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booth mode could not be changed.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div id="booth-mode" className="scroll-mt-24">
      {on ? (
        <>
          {origin ? <BoothAttendees eventId={eventId} origin={origin} /> : null}
          <p className="mt-2 text-right text-xs">
            <button
              type="button"
              disabled={working}
              onClick={() => void change(false)}
              className="text-charcoal/60 underline hover:text-charcoal disabled:opacity-50"
            >
              {working ? 'Turning off…' : 'Turn booth mode off'}
            </button>
          </p>
        </>
      ) : (
        <div className="spx-card mt-6 p-6">
          <p className="spx-eyebrow">Included with your event</p>
          <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.02em]">
            Booth mode: headshots and trade shows
          </h2>
          <p className="spx-body mt-2 text-sm">
            Each person signs up and gets a QR code. Your photographer scans it before their
            shot, and each person is emailed only their own photos, full resolution, instead of
            a shared gallery.
          </p>
          <button
            type="button"
            disabled={working}
            onClick={() => void change(true)}
            className="spx-btn-ink mt-4 disabled:opacity-50"
          >
            {working ? 'Turning on…' : 'Turn on booth mode'}
          </button>
        </div>
      )}
      {error ? (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
