import { useMemo, useState } from 'react';
import Notice from '@/components/Notice';
import { FallbackImage } from '@/components/FallbackMedia';
import { QrScanner } from '@/components/BoothPanel';
import { assignBoothPhotos, type BoothStatusView } from '@/lib/api';
import { boothGroups } from '@/lib/boothGroups';
import type { DisplayPhoto } from '@/lib/types';

/**
 * The booth fix-up screen (docs/booth-mode.md, step 3): photos grouped by who
 * they go to, and the four fixes — move to someone, also send to someone (a
 * group shot), take someone off, or unassign. Every change is re-checked by
 * the server; this only decides which buttons to draw.
 */
export default function BoothFixUp({
  eventId,
  photos,
  status,
  onChange,
}: {
  eventId: string;
  photos: DisplayPhoto[];
  status: BoothStatusView;
  onChange: () => void;
}) {
  const groups = useMemo(
    () => boothGroups(photos.map((p) => p.id), status.assignments, status.people),
    [photos, status.assignments, status.people],
  );
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);

  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [personId, setPersonId] = useState('');
  const [working, setWorking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const group = groups.find((g) => g.key === open) ?? null;
  const isPersonGroup =
    group !== null && group.key !== 'check' && group.key !== 'none' && group.key !== 'dividers';

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(
    action: 'set' | 'add' | 'remove' | 'clear' | 'divider',
    target: { attendeeId?: string; token?: string } = {},
  ) {
    if (selected.size === 0) return;
    setWorking(true);
    setNote(null);
    try {
      const result = await assignBoothPhotos({ eventId, uploadIds: [...selected], action, ...target });
      setNote({ tone: result.ok ? 'success' : 'error', text: result.message });
      if (result.ok) {
        setSelected(new Set());
        onChange();
      }
    } catch (err) {
      setNote({ tone: 'error', text: err instanceof Error ? err.message : 'That change did not go through.' });
    } finally {
      setWorking(false);
    }
  }

  if (groups.length === 0) return null;

  return (
    <div className="mt-6 border border-charcoal/15 p-4">
      <h2 className="font-sans text-lg font-semibold">Sort photos by person</h2>
      <p className="mt-1 text-sm text-charcoal/65">
        Open a group, select photos, then move them, add a person for a group shot, or take
        someone off. Nothing is sent until you approve it.
      </p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {groups.map((g) => (
          <li key={g.key}>
            <button
              type="button"
              onClick={() => {
                setOpen(open === g.key ? null : g.key);
                setSelected(new Set());
                setNote(null);
              }}
              className={`border px-3 py-1.5 text-sm transition ${
                open === g.key
                  ? 'border-ink bg-ink text-canvas'
                  : g.key === 'check' || g.key === 'none'
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-charcoal/25 hover:border-charcoal/60'
              }`}
            >
              {g.label} ({g.photoIds.length})
            </button>
          </li>
        ))}
      </ul>

      {group ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() =>
                setSelected(
                  selected.size === group.photoIds.length ? new Set() : new Set(group.photoIds),
                )
              }
              className="underline"
            >
              {selected.size === group.photoIds.length ? 'Select none' : 'Select all'}
            </button>
            <span className="text-charcoal/70">{selected.size} selected</span>
          </div>

          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
            {group.photoIds.map((id) => {
              const photo = byId.get(id);
              const assignment = status.assignments.get(id);
              const isOn = selected.has(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-pressed={isOn}
                    className={`relative block w-full border-2 ${isOn ? 'border-pine' : 'border-transparent'}`}
                  >
                    <FallbackImage
                      source={{ primary: photo?.url ?? '', fallback: photo?.fallbackUrl ?? null }}
                      alt=""
                      className="aspect-square w-full bg-charcoal/5 object-cover"
                    />
                    {isOn ? (
                      <span className="absolute right-1 top-1 bg-pine px-1.5 text-xs font-bold text-white">✓</span>
                    ) : null}
                    {assignment && assignment.attendeeNames.length > 1 ? (
                      <span className="absolute bottom-1 left-1 bg-ink/80 px-1.5 text-[10px] text-white">
                        {assignment.attendeeNames.length} people
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {selected.size > 0 ? (
            <div className="sticky bottom-0 mt-4 space-y-3 border-t border-charcoal/15 bg-canvas py-3">
              <label className="block text-sm">
                <span className="font-medium">Person</span>
                <select
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                  className="spx-input mt-1 w-full sm:w-72"
                >
                  <option value="">Choose someone you scanned…</option>
                  {status.people.map((p) => (
                    <option key={p.attendeeId} value={p.attendeeId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={working || !personId}
                  onClick={() => void run('set', { attendeeId: personId })}
                  className="spx-btn-ink disabled:opacity-40"
                >
                  Move to this person
                </button>
                <button
                  type="button"
                  disabled={working || !personId}
                  onClick={() => void run('add', { attendeeId: personId })}
                  className="border border-charcoal/25 px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  Also send to this person
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => setScanning(true)}
                  className="border border-charcoal/25 px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  Scan a code to move
                </button>
                {isPersonGroup ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void run('remove', { attendeeId: group.key })}
                    className="border border-charcoal/25 px-4 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    Take {group.label} off
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void run('clear')}
                  className="px-2 py-2 text-sm text-charcoal/70 underline disabled:opacity-40"
                >
                  Unassign
                </button>
                {group.key !== 'dividers' ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void run('divider')}
                    className="px-2 py-2 text-sm text-charcoal/70 underline disabled:opacity-40"
                  >
                    Mark as divider
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {note ? (
        <Notice tone={note.tone} className="mt-3">
          {note.text}
        </Notice>
      ) : null}

      {scanning ? (
        <QrScanner
          onToken={(token) => {
            setScanning(false);
            void run('set', { token });
          }}
          onClose={() => setScanning(false)}
        />
      ) : null}
    </div>
  );
}
