import { useCallback, useEffect, useState } from 'react';
import Notice from '@/components/Notice';
import { fetchGuestBookForHost, setGuestBookEntryHidden } from '@/lib/api';
import { entryNeedsReview } from '@/lib/guestBook';
import type { HostGuestBookEntry } from '@/lib/types';

/**
 * The host's view of their guest book.
 *
 * Reads the model directly rather than the public query, so it shows
 * everything: the notes guests can see, the ones held for review, and the ones
 * the host has already taken down. Owner auth is what scopes this to their own
 * events — the same mechanism the photo moderation view uses.
 *
 * Deliberately no delete. A host can hide a note, which is reversible and
 * enough for every real case; permanently destroying something a guest wrote at
 * someone's wedding is not a button worth building on a dashboard that is one
 * mis-tap wide.
 */
export default function GuestBookModeration({ eventId }: { eventId: string }) {
  const [entries, setEntries] = useState<HostGuestBookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setEntries(await fetchGuestBookForHost(eventId));
    } catch {
      setError('Could not load the guest book. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(entry: HostGuestBookEntry) {
    setBusyId(entry.id);
    setError(null);
    try {
      await setGuestBookEntryHidden(entry.id, entry.hidden !== true);
      await load();
    } catch {
      setError('That change did not save. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  const held = entries.filter(entryNeedsReview);

  return (
    <section className="spx-card mt-8 p-6" aria-labelledby="guest-book-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="guest-book-heading" className="font-sans text-lg font-bold tracking-[-0.02em]">
          Guest book
        </h2>
        <p className="text-sm text-charcoal/60">
          {entries.length} {entries.length === 1 ? 'note' : 'notes'}
          {held.length > 0 ? ` · ${held.length} waiting for you` : ''}
        </p>
      </div>

      {error ? (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-charcoal/60">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-charcoal/60">
          No notes yet. Guests can sign it from the upload page or the gallery.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {entries.map((entry) => {
            const hidden = entry.hidden === true;
            const waiting = entryNeedsReview(entry);
            return (
              <li
                key={entry.id}
                className={`border p-4 ${
                  waiting
                    ? 'border-charcoal/10 border-l-2 border-l-amber-600 bg-paper'
                    : 'border-charcoal/10 bg-paper'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{entry.name}</p>
                    {entry.message ? (
                      // Rendered as text. Nothing here builds HTML from a guest.
                      <p className="mt-1 whitespace-pre-line text-sm text-ink/80">
                        {entry.message}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm italic text-charcoal/60">
                        Left a photo or video message.
                      </p>
                    )}
                    {entry.photoId ? (
                      <p className="mt-1 text-xs text-charcoal/60">With an attachment.</p>
                    ) : null}
                    {waiting ? (
                      <p className="mt-2 text-xs font-medium text-amber-800">
                        Held for review
                        {entry.moderationReasons ? ` — ${entry.moderationReasons}` : ''}. Guests
                        can&apos;t see this yet.
                      </p>
                    ) : hidden ? (
                      <p className="mt-2 text-xs font-medium text-charcoal/60">
                        Hidden from guests.
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle(entry)}
                    disabled={busyId === entry.id}
                    className="shrink-0 border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-60"
                  >
                    {busyId === entry.id ? 'Saving…' : hidden || waiting ? 'Show' : 'Hide'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
