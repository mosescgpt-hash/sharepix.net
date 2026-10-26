import { useMemo, useState } from 'react';
import Notice from '@/components/Notice';
import { FallbackImage } from '@/components/FallbackMedia';
import { assignBoothPhotos, type BoothStatusView } from '@/lib/api';
import { boothGroups } from '@/lib/boothGroups';
import { photoCount } from '@/lib/boothSteps';
import type { DisplayPhoto } from '@/lib/types';

/**
 * Step 4 of the host's Booth tab: who is in each photo. Tap a group, tap
 * photos, then say who they go to. Big buttons and plain words, because a
 * host does this on a phone. The photographer's review page keeps its own
 * sorter (BoothFixUp); the server re-checks every change either way.
 */

const GROUP_LABEL: Record<string, string> = {
  check: 'Please check',
  none: 'Not matched to anyone',
  dividers: 'QR code photos (never sent)',
  event: 'Event photos',
  stopped: 'Stopped — held, not sent',
};

const GROUP_HINT: Record<string, string> = {
  check: 'We guessed who these go to from when they were uploaded. Make sure they are right.',
  none: 'We could not tell who these go to. Pick a person for each one.',
  dividers: 'These are the QR code photos. They are only used for sorting and never sent.',
  event: 'Taken after the event start code. They go to no one person. Move any that belong to someone.',
  stopped: 'Taken after the stop code. They are kept, not sent. Move any you want to keep to a person or the event.',
};

/** Groups that are not a person. */
function isPersonGroup(key: string): boolean {
  return !(key in GROUP_LABEL) && !key.startsWith('cat:');
}

const BTN = 'min-h-[48px] px-4 py-2 text-base font-medium disabled:opacity-40';

export default function BoothSort({
  eventId,
  status,
  onChange,
  categories = [],
}: {
  eventId: string;
  status: BoothStatusView;
  onChange: () => void | Promise<void>;
  /** The event's categories (start & stop codes), for "Move to a category". */
  categories?: { id: string; name: string }[];
}) {
  const photos = useMemo(() => boothTiles(status, eventId), [status, eventId]);
  const groups = useMemo(
    () => boothGroups(photos.map((p) => p.id), status.assignments, status.people),
    [photos, status.assignments, status.people],
  );
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);

  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [personId, setPersonId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const group = groups.find((g) => g.key === open) ?? null;
  const isPerson = group !== null && isPersonGroup(group.key);

  if (photos.length === 0) {
    return <p className="mt-3 text-sm text-charcoal/70">No photos yet. Upload them in step 3.</p>;
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(
    action: 'set' | 'add' | 'remove' | 'clear' | 'divider' | 'event' | 'category',
    attendeeId?: string,
    catId?: string,
  ) {
    if (selected.size === 0) return;
    setWorking(true);
    setNote(null);
    try {
      const result = await assignBoothPhotos({ eventId, uploadIds: [...selected], action, attendeeId, categoryId: catId });
      setNote({ ok: result.ok, text: result.message });
      if (result.ok) {
        setSelected(new Set());
        await onChange();
      }
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : 'That change did not go through.' });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-3">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {groups.map((g) => {
          const warn = g.key === 'check' || g.key === 'none' || g.key === 'stopped';
          const on = open === g.key;
          return (
            <li key={g.key}>
              <button
                type="button"
                aria-expanded={on}
                onClick={() => {
                  setOpen(on ? null : g.key);
                  setSelected(new Set());
                  setNote(null);
                }}
                className={`flex min-h-[52px] w-full items-center justify-between gap-2 border px-4 text-left text-base ${
                  on
                    ? 'border-ink bg-ink text-canvas'
                    : warn
                      ? 'border-amber-300 bg-amber-50 text-amber-900'
                      : 'border-charcoal/25'
                }`}
              >
                <span className="min-w-0 truncate font-medium">{GROUP_LABEL[g.key] ?? g.label}</span>
                <span className="shrink-0 text-sm">{photoCount(g.photoIds.length)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {group ? (
        <div className="mt-4">
          <p className="text-sm text-charcoal/80">
            {GROUP_HINT[group.key] ??
              (group.key.startsWith('cat:')
                ? `Taken after the ${group.label.replace(/ — category photos$/, '')} start code. They go to no one person.`
                : null) ??
              `These go to ${group.label}. Tap any that are not ${group.label}, then choose what to do below.`}
          </p>
          <div className="mt-2 flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() =>
                setSelected(selected.size === group.photoIds.length ? new Set() : new Set(group.photoIds))
              }
              className="min-h-[44px] underline"
            >
              {selected.size === group.photoIds.length ? 'Select none' : 'Select all'}
            </button>
            <span className="text-charcoal/70">{selected.size} selected</span>
          </div>

          <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
            {group.photoIds.map((id) => {
              const photo = byId.get(id);
              const a = status.assignments.get(id);
              const isOn = selected.has(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-pressed={isOn}
                    aria-label={isOn ? 'Selected photo' : 'Photo'}
                    className={`relative block w-full border-4 ${isOn ? 'border-pine' : 'border-transparent'}`}
                  >
                    <FallbackImage
                      source={{ primary: photo?.url ?? '', fallback: photo?.fallbackUrl ?? null }}
                      alt=""
                      className="aspect-square w-full bg-charcoal/5 object-cover"
                    />
                    {isOn ? (
                      <span className="absolute right-1 top-1 bg-pine px-2 text-sm font-bold text-white">✓</span>
                    ) : null}
                    {a?.publishStatus === 'approved' || a?.publishStatus === 'published' ? (
                      <span className="absolute left-1 top-1 bg-pine/90 px-1.5 text-[11px] font-semibold text-white">
                        {a.publishStatus === 'published' ? 'In gallery' : 'Sent'}
                      </span>
                    ) : null}
                    {a?.guestUpload ? (
                      <span className="absolute bottom-1 right-1 bg-ink/80 px-1.5 text-[11px] text-white">From guest</span>
                    ) : null}
                    {a && a.attendeeNames.length > 1 ? (
                      <span className="absolute bottom-1 left-1 bg-ink/80 px-1.5 text-[11px] text-white">
                        {a.attendeeNames.length} people
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {selected.size > 0 ? (
            <div className="sticky bottom-0 z-10 mt-4 space-y-3 border-t border-charcoal/15 bg-canvas py-3">
              <p className="text-sm font-medium">With the {photoCount(selected.size)} you picked:</p>
              <label className="block text-sm">
                <span className="font-medium">Who are they of?</span>
                <select
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                  className="spx-input mt-1 min-h-[48px] w-full text-base sm:w-80"
                >
                  <option value="">Choose a person…</option>
                  {status.people.map((p) => (
                    <option key={p.attendeeId} value={p.attendeeId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <button
                  type="button"
                  disabled={working || !personId}
                  onClick={() => void run('set', personId)}
                  className={`spx-btn-ink ${BTN}`}
                >
                  Move to this person
                </button>
                <button
                  type="button"
                  disabled={working || !personId}
                  onClick={() => void run('add', personId)}
                  className={`border border-charcoal/30 ${BTN}`}
                >
                  Also send to this person
                </button>
              </div>
              <p className="text-xs text-charcoal/70">
                Move: the photos go only to that person. Also send: for group photos, they go to this person too.
              </p>
              <div className="grid grid-cols-1 gap-2 border-t border-charcoal/10 pt-3 sm:flex sm:flex-wrap">
                {isPerson ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void run('remove', group.key)}
                    className={`border border-charcoal/30 ${BTN}`}
                  >
                    Not {group.label}
                  </button>
                ) : null}
                {group.key !== 'event' ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void run('event')}
                    className={`border border-charcoal/30 ${BTN}`}
                  >
                    Move to event photos
                  </button>
                ) : null}
                {categories.length > 0 ? (
                  <span className="flex gap-2">
                    <select
                      aria-label="Category"
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="spx-input min-h-[48px] text-base"
                    >
                      <option value="">Choose a category…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={working || !categoryId}
                      onClick={() => void run('category', undefined, categoryId)}
                      className={`border border-charcoal/30 ${BTN}`}
                    >
                      Move to category
                    </button>
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void run('clear')}
                  className={`border border-charcoal/30 ${BTN}`}
                >
                  Unassign (nobody)
                </button>
                {group.key !== 'dividers' ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void run('divider')}
                    className={`border border-charcoal/30 ${BTN}`}
                  >
                    Mark as QR shot
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {note ? (
        <Notice tone={note.ok ? 'success' : 'error'} className="mt-3">
          {note.text}
        </Notice>
      ) : null}
    </div>
  );
}

/** The booth photos as tiles, oldest first, rejected ones left out. */
export function boothTiles(status: BoothStatusView, eventId: string): DisplayPhoto[] {
  return [...status.assignments.entries()]
    .filter(([, a]) => a.publishStatus !== 'rejected')
    .sort(([, a], [, b]) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    .map(([id, a]) => ({ id, eventId, url: a.thumbUrl ?? '' }) as unknown as DisplayPhoto);
}
