import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Notice from '@/components/Notice';
import { listBoothAttendees, resendBoothEmail } from '@/lib/api';
import { boothGalleryPath, boothKioskPath, boothSignupPath } from '@/lib/booth';
import type { BoothAttendeeRow } from '@/lib/types';

/**
 * The host's view of a booth-mode event: where attendees sign up, and who has.
 * See docs/booth-mode.md. Shown only when an admin has switched booth mode on.
 */
export default function BoothAttendees({ eventId, origin }: { eventId: string; origin: string }) {
  const [rows, setRows] = useState<BoothAttendeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-row Resend: the row being sent, then what happened.
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, { ok: boolean; message: string }>>({});

  async function resend(row: BoothAttendeeRow) {
    setSending(row.id);
    try {
      const result = await resendBoothEmail(eventId, row.id);
      setSent((current) => ({ ...current, [row.id]: result }));
      if (result.ok) {
        const now = new Date().toISOString();
        setRows((current) => current?.map((r) => (r.id === row.id ? { ...r, lastDeliveredAt: now } : r)) ?? null);
      }
    } catch (err) {
      setSent((current) => ({
        ...current,
        [row.id]: { ok: false, message: err instanceof Error ? err.message : 'The email could not be sent.' },
      }));
    } finally {
      setSending(null);
    }
  }

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
  const offlineKiosk = `${origin}${boothKioskPath(eventId)}`;

  return (
    <div id="booth" className="spx-card scroll-mt-24 mt-6 p-6">
      <p className="spx-eyebrow">Booth mode</p>
      <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.02em]">Attendee sign-up</h2>
      <p className="spx-body mt-2 text-sm">
        Each person signs up once and gets a code. Whoever is taking photos (you or a
        photographer) photographs it before their photo, and their photos are sent to them —
        not to a shared gallery. Each person is emailed within the hour once you approve their
        photos below.
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
            <span className="mt-1 block text-xs text-charcoal/70">
              Remembers nothing between people and clears itself after each sign-up.
            </span>
          </p>
          <p>
            <span className="font-medium">No signal at the venue?</span>{' '}
            <a href={offlineKiosk} target="_blank" rel="noopener noreferrer" className="break-all text-pine underline">
              Open the offline kiosk
            </a>
            <span className="mt-1 block text-xs text-charcoal/70">
              Open it once with a connection; it then works offline. Whoever is shooting takes one
              photo of each person&apos;s code, then their photos. Contact details are locked
              inside the code — you see a masked label. If the code photo is lost, so is that
              sign-up.
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
        <p className="mt-2 text-sm text-charcoal/70">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-charcoal/70">Nobody yet.</p>
      ) : (
        <ul className="mt-2 max-h-80 divide-y divide-charcoal/10 overflow-y-auto border-y border-charcoal/10">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium">{row.name}</span>
              <span className="min-w-0 truncate text-charcoal/70">{row.contactLabel}
                {row.texting ? ' · text' : ''}
              </span>
              <span className="flex shrink-0 items-baseline gap-3 text-xs">
                <span className="text-charcoal/70">
                  {row.emailsStopped
                    ? 'Stopped emails'
                    : row.lastDeliveredAt
                      ? `Emailed ${new Date(row.lastDeliveredAt).toLocaleDateString()}`
                      : 'Not emailed yet'}
                </span>
                {row.galleryKey ? (
                  <a
                    href={`${origin}${boothGalleryPath(row.galleryKey)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-pine underline"
                  >
                    Their photos
                  </a>
                ) : null}
                {row.galleryKey && !row.emailsStopped ? (
                  <button
                    type="button"
                    onClick={() => void resend(row)}
                    disabled={sending !== null}
                    className="text-pine underline disabled:opacity-50"
                  >
                    {sending === row.id ? 'Sending…' : 'Resend'}
                  </button>
                ) : null}
              </span>
              {sent[row.id] ? (
                <span className={`basis-full text-xs ${sent[row.id].ok ? 'text-pine' : 'text-red-700'}`}>
                  {sent[row.id].message}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
