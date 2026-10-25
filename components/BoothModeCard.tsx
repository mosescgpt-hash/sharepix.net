import { useState } from 'react';
import Notice from '@/components/Notice';
import { setEventBoothModeAsHost } from '@/lib/api';

/**
 * Booth mode's switch on the host's Extras tab (docs/booth-mode.md). Off, it
 * explains booth mode and turns it on. On, it points to the Booth tab, where
 * everything for booth mode lives (and where it is turned off).
 */
export default function BoothModeCard({
  eventId,
  on,
  onChanged,
  onOpenBooth,
}: {
  eventId: string;
  on: boolean;
  onChanged: (on: boolean) => void;
  onOpenBooth: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function turnOn() {
    setWorking(true);
    setError(null);
    try {
      await setEventBoothModeAsHost(eventId, true);
      onChanged(true);
      onOpenBooth();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booth mode could not be changed.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div id="booth-mode" className="spx-card scroll-mt-24 mt-6 p-6">
      <p className="spx-eyebrow">Included with your event</p>
      <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.02em]">Booth mode: headshots and trade shows</h2>
      {on ? (
        <>
          <p className="spx-body mt-2 text-sm">
            Booth mode is on. Sign-ups, photos and sending are all on the Booth tab.
          </p>
          <button type="button" onClick={onOpenBooth} className="spx-btn-ink mt-4 min-h-[48px]">
            Open the Booth tab
          </button>
        </>
      ) : (
        <>
          <p className="spx-body mt-2 text-sm">
            Each person signs up and gets a QR code. You (or your photographer) photograph the code before each
            person&apos;s shot, and each person is emailed only their own photos, full resolution, instead of a
            shared gallery.
          </p>
          <button
            type="button"
            disabled={working}
            onClick={() => void turnOn()}
            className="spx-btn-ink mt-4 min-h-[48px] disabled:opacity-50"
          >
            {working ? 'Turning on…' : 'Turn on booth mode'}
          </button>
        </>
      )}
      {error ? (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
