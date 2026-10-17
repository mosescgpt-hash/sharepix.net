import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Notice from '@/components/Notice';
import { listBoothAttendees } from '@/lib/api';
import { boothSignupPath } from '@/lib/booth';
import type { BoothAttendeeRow } from '@/lib/types';

/**
 * The host's view of a booth-mode event: where attendees sign up, and who has.
 * See docs/booth-mode.md. Shown only when an admin has switched booth mode on.
 */
export default function BoothAttendees({ eventId, origin }: { eventId: string; origin: string }) {
  const [rows, setRows] = useState<BoothAttendeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBoothAttendees(eventId)
      .then((list) => {
        setRows(list);
        setError(null);
      })
      .catch((err) => {
        setRows([]);
        setError(err instanceof Error ? err.message : 'Attendees could not be loaded.');
      });
  }, [eventId]);

  const signup = `${origin}${boothSignupPath(eventId)}`;
  const kiosk = `${origin}${boothSignupPath(eventId, true)}`;

  return (
    <div id="booth" className="spx-card scroll-mt-24 mt-6 p-6">
      <p className="spx-eyebrow">Booth mode</p>
      <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.02em]">Attendee sign-up</h2>
      <p className="spx-body mt-2 text-sm">
        Each person signs up once and gets a code. The photographer scans it before their
        photo, and their photos are sent to them — not to a shared gallery.
      </p>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="shrink-0 bg-white p-3">
          <QRCodeSVG value={signup} size={128} level="M" aria-label="Sign-up QR code" />
        </div>
        <div className="min-w-0 space-y-3 text-sm">
          <p>
            <span className="font-medium">For a sign or badge:</span>{' '}
            <a href={signup} className="break-all text-pine underline">
              {signup}
            </a>
          </p>
          <p>
            <span className="font-medium">For a tablet or computer at the booth:</span>{' '}
            <a href={kiosk} target="_blank" rel="noopener noreferrer" className="break-all text-pine underline">
              Open kiosk mode
            </a>
            <span className="mt-1 block text-xs text-charcoal/60">
              Remembers nothing between people and clears itself after each sign-up.
            </span>
          </p>
        </div>
      </div>

      <h3 className="mt-6 font-sans text-base font-semibold">
        Signed up{rows ? ` (${rows.length})` : ''}
      </h3>
      {error ? (
        <Notice tone="warn" className="mt-2">
          {error}
        </Notice>
      ) : null}
      {rows === null ? (
        <p className="mt-2 text-sm text-charcoal/55">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-charcoal/55">Nobody yet.</p>
      ) : (
        <ul className="mt-2 max-h-80 divide-y divide-charcoal/10 overflow-y-auto border-y border-charcoal/10">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium">{row.name}</span>
              <span className="min-w-0 truncate text-charcoal/60">{row.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
