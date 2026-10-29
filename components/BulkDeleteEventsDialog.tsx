import { useState } from 'react';
import { BULK_DELETE_PHRASE, confirmsBulkDelete, eventCountLabel } from '@/lib/bulkDeleteEvents';

export interface BulkDeleteEventSummary {
  id: string;
  name: string;
  photoCount?: number | null;
}

interface Props {
  events: BulkDeleteEventSummary[];
  /** Runs the deletes; resolves when every event has been tried. */
  deleting: boolean;
  progress: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const SHOWN_NAMES = 6;

/**
 * Confirms a bulk delete: names the count, warns that photos are permanently
 * removed, and asks for the word DELETE to be typed before the red button
 * works.
 */
export default function BulkDeleteEventsDialog({ events, deleting, progress, onCancel, onConfirm }: Props) {
  const [typed, setTyped] = useState('');
  const photos = events.reduce((sum, e) => sum + (e.photoCount ?? 0), 0);
  const label = eventCountLabel(events.length);
  const ready = confirmsBulkDelete(typed) && !deleting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-delete-title"
    >
      <div className="w-full max-w-md border border-red-300 bg-canvas p-6 text-charcoal shadow-xl">
        <h2 id="bulk-delete-title" className="font-sans text-xl font-bold text-red-800">
          Delete {label}?
        </h2>
        <p className="mt-3 text-sm leading-relaxed">
          This permanently removes {events.length === 1 ? 'this event' : 'these events'}
          {photos > 0 ? ` and ${photos} photo${photos === 1 ? '' : 's'}` : ' and all of their photos'}. It can&rsquo;t
          be undone.
        </p>
        <ul className="mt-3 max-h-40 list-disc overflow-auto pl-5 text-sm">
          {events.slice(0, SHOWN_NAMES).map((e) => (
            <li key={e.id}>{e.name}</li>
          ))}
          {events.length > SHOWN_NAMES ? <li>and {events.length - SHOWN_NAMES} more</li> : null}
        </ul>
        <p className="mt-3 text-xs text-charcoal/70">
          An event SharePix has closed or has under content review is taken out of your account, and its media is
          preserved, the same as when you delete it from its own page.
        </p>
        <label className="mt-4 block text-sm font-medium">
          Type {BULK_DELETE_PHRASE} to confirm
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            disabled={deleting}
            className="spx-input mt-1 w-full"
          />
        </label>
        {deleting ? (
          <p className="mt-3 text-sm font-medium" role="status">
            {progress || 'Deleting…'}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="border border-charcoal/25 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!ready}
            className="bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-40"
          >
            {deleting ? 'Deleting…' : `Permanently delete ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
