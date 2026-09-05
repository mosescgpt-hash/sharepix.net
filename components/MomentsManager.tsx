import { FormEvent, useCallback, useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import Notice from '@/components/Notice';
import { deleteEventMoment, fetchEventMoments, saveEventMoment } from '@/lib/api';
import {
  MAX_MOMENTS_PER_EVENT,
  MAX_MOMENT_DESCRIPTION_LENGTH,
  MAX_MOMENT_NAME_LENGTH,
  momentUploadPath,
  nextSortOrder,
  sortMoments,
  validateMoment,
} from '@/lib/moments';
import type { EventMoment } from '@/lib/types';

interface MomentsManagerProps {
  eventId: string;
  /** Absolute origin for the printed QR codes, e.g. https://www.sharepix.net */
  origin: string;
}

/**
 * The host's list of moments, on the event dashboard.
 *
 * Each moment gets its own QR code, which is the point of the whole feature:
 * the card on the ceremony chairs and the card on the dinner tables are the
 * same event, but a photo scanned from one files differently from the other,
 * without the guest choosing anything.
 */
export default function MomentsManager({ eventId, origin }: MomentsManagerProps) {
  const [moments, setMoments] = useState<EventMoment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showQrFor, setShowQrFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMoments(await fetchEventMoments(eventId));
      setError(null);
    } catch {
      setError('We could not load this event’s moments.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setName('');
    setDescription('');
    setEditingId(null);
  }

  async function handleSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    if (busy) return;

    // The same rules the Lambda applies, run here first so the host is told
    // immediately rather than after a round trip. The server still decides.
    const checked = validateMoment({ name, description });
    if (!checked.ok) {
      setError(checked.reason);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await saveEventMoment({
        eventId,
        momentId: editingId,
        name: checked.moment.name,
        description: checked.moment.description,
        // A new moment goes on the end; a rename keeps the place it already has.
        sortOrder: editingId
          ? (moments.find((moment) => moment.id === editingId)?.sortOrder ?? 0)
          : nextSortOrder(moments),
      });
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That moment could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(moment: EventMoment) {
    if (
      !window.confirm(
        `Remove “${moment.name}”? Photos filed under it stay in the gallery — they just stop being grouped.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteEventMoment(moment.id);
      if (editingId === moment.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That moment could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  const ordered = sortMoments(moments);
  const full = ordered.length >= MAX_MOMENTS_PER_EVENT;

  return (
    <section className="spx-card mt-10 p-6" aria-labelledby="moments-heading">
      <h2 id="moments-heading" className="font-sans text-xl font-bold tracking-[-0.02em]">
        Moments
      </h2>
      <p className="mt-1 text-sm text-charcoal/60">
        The parts of your event — &ldquo;Getting ready&rdquo;, &ldquo;Ceremony&rdquo;,
        &ldquo;Reception&rdquo;. Each one gets its own QR code, so a photo added from the card on
        the ceremony chairs files differently from one added at dinner. Optional: guests can
        always just upload.
      </p>

      {error ? (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-charcoal/60">Loading&hellip;</p>
      ) : (
        <>
          {ordered.length === 0 ? (
            <p className="mt-5 text-sm text-charcoal/60">
              No moments yet. Add one below, or leave this empty and every photo simply lands in
              the one gallery.
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-charcoal/10 border-y border-charcoal/10">
              {ordered.map((moment) => (
                <li key={moment.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-sans font-semibold text-charcoal">{moment.name}</p>
                      {moment.description ? (
                        <p className="mt-0.5 text-sm text-charcoal/60">{moment.description}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 text-sm">
                      <button
                        type="button"
                        onClick={() => setShowQrFor(showQrFor === moment.id ? null : moment.id)}
                        className="border border-charcoal/25 px-3 py-1.5 font-medium text-charcoal transition hover:border-charcoal/60"
                      >
                        {showQrFor === moment.id ? 'Hide QR' : 'QR code'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(moment.id);
                          setName(moment.name);
                          setDescription(moment.description ?? '');
                          setError(null);
                        }}
                        className="border border-charcoal/25 px-3 py-1.5 font-medium text-charcoal transition hover:border-charcoal/60"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDelete(moment)}
                        className="border border-red-300 px-3 py-1.5 font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {showQrFor === moment.id ? (
                    <div className="mt-4 flex flex-col items-center gap-3 bg-sand p-5 text-center">
                      <QRCodeCanvas
                        value={`${origin}${momentUploadPath(eventId, moment.id)}`}
                        size={168}
                        includeMargin
                      />
                      <p className="font-serif text-lg italic">{moment.name}</p>
                      <p className="break-all text-xs text-charcoal/60">
                        {origin}
                        {momentUploadPath(eventId, moment.id)}
                      </p>
                      <p className="text-xs text-charcoal/55">
                        Print this for the {moment.name.toLowerCase()} tables. Scanning it opens
                        the upload page with this moment already chosen.
                      </p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleSubmit} className="mt-6">
            <label
              htmlFor="moment-name"
              className="block font-sans text-sm font-medium text-charcoal"
            >
              {editingId ? 'Rename this moment' : 'Add a moment'}
            </label>
            <input
              id="moment-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_MOMENT_NAME_LENGTH}
              placeholder="Ceremony"
              disabled={busy || (full && !editingId)}
              className="spx-input mt-2 disabled:bg-sand disabled:text-charcoal/50"
            />

            <label
              htmlFor="moment-description"
              className="mt-4 block font-sans text-sm font-medium text-charcoal"
            >
              Description <span className="text-charcoal/50">(optional)</span>
            </label>
            <input
              id="moment-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_MOMENT_DESCRIPTION_LENGTH}
              placeholder="Before the meal, in the garden"
              disabled={busy || (full && !editingId)}
              className="spx-input mt-2 disabled:bg-sand disabled:text-charcoal/50"
            />

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={busy || !name.trim() || (full && !editingId)}
                className="spx-btn-ink disabled:opacity-50"
              >
                {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add moment'}
              </button>
              {editingId ? (
                <button type="button" onClick={resetForm} className="spx-btn-outline">
                  Cancel
                </button>
              ) : null}
            </div>

            {full && !editingId ? (
              <p className="mt-3 text-xs text-charcoal/55">
                You have the maximum of {MAX_MOMENTS_PER_EVENT} moments. Remove one to add
                another.
              </p>
            ) : null}
          </form>
        </>
      )}
    </section>
  );
}
