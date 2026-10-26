import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Notice from '@/components/Notice';
import BoothSort from '@/components/BoothSort';
import BoothCodes from '@/components/BoothCodes';
import {
  decideProPhoto,
  fetchBoothStatus,
  listBoothAttendees,
  processProPhoto,
  requestProUploadSlot,
  resendBoothEmail,
  setEventBoothModeAsHost,
  type BoothStatusView,
} from '@/lib/api';
import { boothGalleryPath, boothKioskPath, boothSignupPath } from '@/lib/booth';
import {
  BOOTH_STATE_LABEL,
  boothPersonStatuses,
  everythingToApprove,
  photoCount,
  type BoothPersonState,
} from '@/lib/boothSteps';
import type { BoothAttendeeRow } from '@/lib/types';

/**
 * The host's Booth tab (docs/booth-mode.md): everything for booth mode, in the
 * order a host does it, as five numbered steps. The photographer's review
 * page keeps its own scanner and sorter; this is the host's own way through.
 * The server re-checks every action (host or admin, booth-mode event only).
 */
export default function BoothTab({
  eventId,
  origin,
  onTurnedOff,
}: {
  eventId: string;
  origin: string;
  onTurnedOff: () => void;
}) {
  const [rows, setRows] = useState<BoothAttendeeRow[] | null>(null);
  const [status, setStatus] = useState<BoothStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    const [attendees, booth] = await Promise.allSettled([listBoothAttendees(eventId), fetchBoothStatus(eventId)]);
    if (attendees.status === 'fulfilled') setRows(attendees.value);
    else setRows((r) => r ?? []);
    if (booth.status === 'fulfilled') setStatus(booth.value);
    setError(
      attendees.status === 'rejected' || booth.status === 'rejected'
        ? 'Some booth details could not be loaded. Refresh the page to try again.'
        : null,
    );
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <SignUpStep eventId={eventId} origin={origin} />
      <BoothCodes eventId={eventId} onCategories={setCategories} />
      <WhoStep eventId={eventId} origin={origin} rows={rows} status={status} />
      <UploadStep eventId={eventId} onUploaded={load} />
      <Step n={4} title="Check who's in each photo" id="booth-sort">
        <p className="spx-body text-sm">
          We sort your photos using the QR code photos: event, category, person, or stopped. Tap a person, check their photos, and fix any
          that landed in the wrong place.
        </p>
        {status ? <BoothSort eventId={eventId} status={status} onChange={load} categories={categories} /> : <Loading />}
      </Step>
      <ApproveStep status={status} onDone={load} />
      <TurnOff eventId={eventId} onTurnedOff={onTurnedOff} />
    </div>
  );
}

function Step({ n, title, id, children }: { n: number; title: string; id: string; children: ReactNode }) {
  return (
    <section id={id} className="spx-card scroll-mt-24 p-5 sm:p-6" aria-labelledby={`${id}-title`}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-base font-bold text-canvas"
        >
          {n}
        </span>
        <h2 id={`${id}-title`} className="font-sans text-xl font-bold tracking-[-0.02em]">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Loading() {
  return <p className="text-sm text-charcoal/70">Loading&hellip;</p>;
}

const BIG = 'inline-flex min-h-[48px] items-center justify-center px-5 py-3 text-base font-medium';

function SignUpStep({ eventId, origin }: { eventId: string; origin: string }) {
  const signup = `${origin}${boothSignupPath(eventId)}`;
  const kiosk = `${origin}${boothSignupPath(eventId, true)}`;
  const offline = `${origin}${boothKioskPath(eventId)}`;
  return (
    <Step n={1} title="Sign people up" id="booth-signup">
      <p className="spx-body text-sm">
        Each person signs up once and gets their own QR code. Only they get their photos, by email.
      </p>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        {origin ? (
          <div className="mx-auto shrink-0 bg-white p-3 sm:mx-0">
            <QRCodeSVG value={signup} size={148} level="M" aria-label="Sign-up QR code" />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          <p>
            <span className="font-medium">Put this on a sign or badge:</span>{' '}
            <a href={signup} className="break-all text-pine underline">
              {signup}
            </a>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={kiosk} target="_blank" rel="noopener noreferrer" className={`spx-btn-ink ${BIG}`}>
              Open kiosk mode
            </a>
            <a
              href={offline}
              target="_blank"
              rel="noopener noreferrer"
              className={`border border-charcoal/30 ${BIG}`}
            >
              Open the offline kiosk
            </a>
          </div>
          <p className="text-xs text-charcoal/70">
            Kiosk mode is for a tablet or computer at the booth; it forgets each person after they sign up. The
            offline kiosk is for places with no signal: open it once while you have a connection.
          </p>
        </div>
      </div>
      <div className="mt-4 border-l-4 border-pine bg-sage/30 p-3 text-sm">
        <p className="font-medium">When you take photos:</p>
        <p className="mt-1">
          Take <strong>two photos of each person&apos;s QR code</strong> first, then their photos. Wait a second
          before you start the next person.
        </p>
      </div>
    </Step>
  );
}

function stateBadge(state: BoothPersonState) {
  const tone =
    state === 'sent'
      ? 'bg-pine text-white'
      : state === 'ready'
        ? 'bg-amber-100 text-amber-900'
        : 'bg-charcoal/10 text-charcoal/80';
  return <span className={`shrink-0 px-2 py-0.5 text-xs font-semibold ${tone}`}>{BOOTH_STATE_LABEL[state]}</span>;
}

function WhoStep({
  eventId,
  origin,
  rows,
  status,
}: {
  eventId: string;
  origin: string;
  rows: BoothAttendeeRow[] | null;
  status: BoothStatusView | null;
}) {
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [delivered, setDelivered] = useState<Record<string, string>>({});

  const states = useMemo(() => {
    if (!rows || !status) return new Map<string, BoothPersonState>();
    return new Map(
      boothPersonStatuses(
        rows.map((r) => ({ attendeeId: r.id, name: r.name })),
        status.assignments,
      ).map((s) => [s.attendeeId, s.state]),
    );
  }, [rows, status]);

  async function resend(row: BoothAttendeeRow) {
    setSending(row.id);
    try {
      const result = await resendBoothEmail(eventId, row.id);
      setSent((c) => ({ ...c, [row.id]: result }));
      if (result.ok) setDelivered((c) => ({ ...c, [row.id]: new Date().toISOString() }));
    } catch (err) {
      setSent((c) => ({
        ...c,
        [row.id]: { ok: false, message: err instanceof Error ? err.message : 'The email could not be sent.' },
      }));
    } finally {
      setSending(null);
    }
  }

  return (
    <Step n={2} title={`Who signed up${rows ? ` (${rows.length})` : ''}`} id="booth-people">
      <p className="spx-body text-sm">Contact details are hidden to protect people&apos;s privacy.</p>
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-charcoal/70">Nobody yet. People appear here as they sign up.</p>
      ) : (
        <ul className="mt-3 max-h-[28rem] divide-y divide-charcoal/10 overflow-y-auto border-y border-charcoal/10">
          {rows.map((row) => {
            const last = delivered[row.id] ?? row.lastDeliveredAt;
            const state = states.get(row.id);
            return (
              <li key={row.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-base font-medium">{row.name}</span>
                  {state ? stateBadge(state) : null}
                </div>
                <p className="mt-0.5 truncate text-charcoal/70">
                  {row.contactLabel}
                  {row.texting ? ' · text' : ''} ·{' '}
                  {row.emailsStopped
                    ? 'Stopped emails'
                    : last
                      ? `Emailed ${new Date(last).toLocaleDateString()}`
                      : 'Not emailed yet'}
                </p>
                {row.galleryKey ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={`${origin}${boothGalleryPath(row.galleryKey)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center border border-charcoal/25 px-4 text-sm font-medium"
                    >
                      Their photos
                    </a>
                    {!row.emailsStopped ? (
                      <button
                        type="button"
                        onClick={() => void resend(row)}
                        disabled={sending !== null}
                        className="inline-flex min-h-[44px] items-center border border-charcoal/25 px-4 text-sm font-medium disabled:opacity-50"
                      >
                        {sending === row.id ? 'Sending…' : 'Resend email'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {sent[row.id] ? (
                  <p className={`mt-1 text-xs ${sent[row.id].ok ? 'text-pine' : 'text-red-700'}`}>
                    {sent[row.id].message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Step>
  );
}

function UploadStep({ eventId, onUploaded }: { eventId: string; onUploaded: () => Promise<void> }) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setMessage(null);
    const list = [...files];
    let failed = 0;
    for (const [i, file] of list.entries()) {
      setUploading(`Uploading ${i + 1} of ${list.length}…`);
      try {
        const slot = await requestProUploadSlot(eventId, file.type || 'image/jpeg');
        const put = await fetch(slot.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'image/jpeg' },
        });
        if (!put.ok) throw new Error('upload failed');
        await processProPhoto(eventId, slot.uploadId);
      } catch {
        failed += 1;
      }
    }
    setUploading(null);
    setMessage(
      failed
        ? { ok: false, text: `${list.length - failed} uploaded; ${failed} did not. Try those again.` }
        : { ok: true, text: `${photoCount(list.length)} uploaded and sorted. Check them in step 4.` },
    );
    await onUploaded();
  }

  return (
    <Step n={3} title="Upload your photos" id="booth-upload">
      <p className="spx-body text-sm">
        Choose all your booth photos at once, QR code photos included. Nothing is sent yet.
      </p>
      <label className={`spx-btn-ink mt-3 w-full cursor-pointer sm:w-auto ${BIG}`}>
        {uploading ?? 'Upload booth photos'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif"
          multiple
          className="sr-only"
          disabled={Boolean(uploading)}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {message ? (
        <Notice tone={message.ok ? 'success' : 'error'} className="mt-3">
          {message.text}
        </Notice>
      ) : null}
    </Step>
  );
}

async function approveAll(ids: string[]) {
  let failed = 0;
  for (const id of ids) {
    try {
      await decideProPhoto(id, 'approve');
    } catch {
      failed += 1;
    }
  }
  return failed;
}

function ApproveStep({ status, onDone }: { status: BoothStatusView | null; onDone: () => Promise<void> }) {
  const [working, setWorking] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const people = useMemo(
    () => (status ? boothPersonStatuses(status.people, status.assignments) : []),
    [status],
  );
  const everything = useMemo(() => everythingToApprove(people), [people]);
  const readyPeople = people.filter((p) => p.state === 'ready');

  async function run(key: string, ids: string[], who: string) {
    setWorking(key);
    setNote(null);
    const failed = await approveAll(ids);
    await onDone();
    setWorking(null);
    setNote(
      failed
        ? { ok: false, text: `${ids.length - failed} approved; ${failed} could not be. Try again.` }
        : { ok: true, text: `Approved ${photoCount(ids.length)} for ${who}. The email goes out within the hour.` },
    );
  }

  function sendEverything() {
    if (everything.length === 0) return;
    const ok = window.confirm(
      `Send everything now?\n\nThis approves ${photoCount(everything.length)} and emails ${readyPeople.length} ${
        readyPeople.length === 1 ? 'person' : 'people'
      } their photos within the hour. These are real emails, and they can't be unsent.`,
    );
    if (ok) void run('all', everything, readyPeople.length === 1 ? readyPeople[0].name : 'everyone');
  }

  return (
    <Step n={5} title="Approve and send" id="booth-approve">
      <p className="spx-body text-sm">
        Approving emails that person a private link to their photos within the hour. Nothing goes out before you
        approve.
      </p>
      {!status ? (
        <Loading />
      ) : people.length === 0 ? (
        <p className="mt-2 text-sm text-charcoal/70">Nobody to send to yet.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-charcoal/10 border-y border-charcoal/10">
            {people.map((p) => (
              <li key={p.attendeeId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-medium">{p.name}</p>
                  <p className="text-xs text-charcoal/70">
                    {p.state === 'waiting'
                      ? 'No photos yet'
                      : p.state === 'ready'
                        ? `${photoCount(p.toApprove.length)} to approve`
                        : `${photoCount(p.photoIds.length)} sent`}
                  </p>
                </div>
                {p.state === 'ready' ? (
                  <button
                    type="button"
                    disabled={working !== null}
                    onClick={() => void run(p.attendeeId, p.toApprove, p.name)}
                    className={`spx-btn-ink w-full sm:w-auto ${BIG} disabled:opacity-40`}
                  >
                    {working === p.attendeeId ? 'Approving…' : `Approve all for ${p.name}`}
                  </button>
                ) : (
                  stateBadge(p.state)
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={working !== null || everything.length === 0}
            onClick={sendEverything}
            className={`spx-btn-ink mt-4 w-full ${BIG} disabled:opacity-40`}
          >
            {working === 'all'
              ? 'Sending…'
              : everything.length === 0
                ? 'Nothing waiting to send'
                : `Approve and send everything (${photoCount(everything.length)})`}
          </button>
        </>
      )}
      {note ? (
        <Notice tone={note.ok ? 'success' : 'error'} className="mt-3">
          {note.text}
        </Notice>
      ) : null}
    </Step>
  );
}

function TurnOff({ eventId, onTurnedOff }: { eventId: string; onTurnedOff: () => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function off() {
    if (
      !window.confirm(
        'Turn booth mode off?\n\nThe sign-up page closes. People who already signed up keep their photo links, and nothing is deleted.',
      )
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await setEventBoothModeAsHost(eventId, false);
      onTurnedOff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booth mode could not be changed.');
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="text-right">
      <button
        type="button"
        disabled={working}
        onClick={() => void off()}
        className="min-h-[44px] px-2 text-sm text-charcoal/70 underline hover:text-charcoal disabled:opacity-50"
      >
        {working ? 'Turning off…' : 'Turn booth mode off'}
      </button>
      {error ? (
        <Notice tone="error" className="mt-2 text-left">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
