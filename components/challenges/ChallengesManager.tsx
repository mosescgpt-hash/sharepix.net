import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchEventChallenges,
  removeChallenge,
  saveChallenge,
  setChallengeSettings,
  type EventChallenge,
} from '@/lib/challenges/api';
import {
  CHALLENGE_PRESETS,
  MAX_ACTIVE_CHALLENGES,
  MAX_CHALLENGE_TEXT,
  cleanChallengeText,
  photoCountsByChallenge,
  sortChallenges,
  type PresetSetKey,
} from '@/lib/challenges/rules';
import type { QREvent } from '@/lib/types';

/**
 * Photo challenges on the host dashboard: the switch, the slideshow caption
 * toggle, presets, the host's own prompts, and how many photos answered each.
 */
export default function ChallengesManager({
  event,
  photos,
  onSettingsSaved,
}: {
  event: QREvent;
  /** The dashboard's photos, for the per-challenge counts. */
  photos: ReadonlyArray<{ challengeId?: string | null }>;
  onSettingsSaved?: () => void;
}) {
  const [challenges, setChallenges] = useState<EventChallenge[]>([]);
  const [enabled, setEnabled] = useState(event.challengesEnabled === true);
  const [captions, setCaptions] = useState(event.challengeCaptions !== false);
  const [presetSet, setPresetSet] = useState<PresetSetKey>('party');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setChallenges(sortChallenges(await fetchEventChallenges(event.id)));
  }, [event.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => photoCountsByChallenge(photos), [photos]);
  const activeCount = challenges.filter((c) => c.active).length;
  const nextOrder = challenges.reduce((max, c) => Math.max(max, c.order), 0) + 1;
  const existingTexts = new Set(challenges.map((c) => c.text.toLowerCase()));

  const run = async (work: () => Promise<{ ok: boolean; message: string }>, reload = true) => {
    setBusy(true);
    setNote(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) setNote({ ok: false, text: result.message });
    if (reload) await load();
    return result.ok;
  };

  const add = async (texts: string[]) => {
    let order = nextOrder;
    for (const text of texts) {
      const ok = await run(
        () => saveChallenge({ eventId: event.id, text, order: order++, active: true }),
        false,
      );
      if (!ok) break;
    }
    await load();
  };

  const saveSetting = async (patch: { enabled?: boolean; captions?: boolean }) => {
    const ok = await run(() => setChallengeSettings(event.id, patch), false);
    if (ok) {
      if (patch.enabled !== undefined) setEnabled(patch.enabled);
      if (patch.captions !== undefined) setCaptions(patch.captions);
      onSettingsSaved?.();
    }
  };

  const presets = CHALLENGE_PRESETS[presetSet].prompts.filter((p) => !existingTexts.has(p.toLowerCase()));
  const cleanDraft = cleanChallengeText(draft);

  return (
    <div className="spx-card mt-6 p-6">
      <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Photo challenges</h2>
      <p className="mt-1 text-sm text-charcoal/60">
        Guests see one random prompt on the upload page and can shuffle it or skip it. The gallery
        gets a filter for each challenge that has photos.
      </p>

      <label className="mt-4 flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => void saveSetting({ enabled: e.target.checked })}
          className="h-5 w-5"
        />
        <span className="text-sm font-medium">Show challenges to guests</span>
      </label>
      <label className="mt-2 flex items-center gap-3">
        <input
          type="checkbox"
          checked={captions}
          disabled={busy}
          onChange={(e) => void saveSetting({ captions: e.target.checked })}
          className="h-5 w-5"
        />
        <span className="text-sm">Show the challenge under its photos on the live slideshow</span>
      </label>

      <p className="mt-5 text-sm font-semibold">
        Your challenges{' '}
        <span className="font-normal text-charcoal/60">
          · {activeCount} of {MAX_ACTIVE_CHALLENGES} active
        </span>
      </p>
      {challenges.length === 0 ? (
        <p className="mt-2 text-sm text-charcoal/60">None yet. Add some from the presets or write your own.</p>
      ) : (
        <ul className="mt-2 divide-y divide-charcoal/10 border border-charcoal/10">
          {challenges.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <label className="flex min-w-0 flex-1 items-center gap-3">
                <input
                  type="checkbox"
                  checked={c.active}
                  disabled={busy || (!c.active && activeCount >= MAX_ACTIVE_CHALLENGES)}
                  onChange={(e) =>
                    void run(() =>
                      saveChallenge({ eventId: event.id, challengeId: c.id, text: c.text, order: c.order, active: e.target.checked }),
                    )
                  }
                  aria-label={`${c.text}: shown to guests`}
                  className="h-4 w-4 flex-none"
                />
                <span className={`min-w-0 break-words text-sm ${c.active ? '' : 'text-charcoal/50 line-through'}`}>
                  {c.text}
                </span>
              </label>
              <span className="text-xs text-charcoal/60">
                {counts.get(c.id) ?? 0} photo{(counts.get(c.id) ?? 0) === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete “${c.text}”? Its photos stay in the gallery, just without the challenge.`)) {
                    void run(() => removeChallenge(event.id, c.id));
                  }
                }}
                className="text-xs font-medium text-red-700 underline underline-offset-2 disabled:opacity-50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (cleanDraft) void add([cleanDraft]).then(() => setDraft(''));
        }}
      >
        <label htmlFor="challenge-draft" className="text-sm font-medium">
          Write your own
        </label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input
            id="challenge-draft"
            value={draft}
            maxLength={MAX_CHALLENGE_TEXT}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A photo with the bride's grandmother"
            className="spx-input min-w-0 flex-1"
          />
          <button
            type="submit"
            disabled={busy || !cleanDraft || activeCount >= MAX_ACTIVE_CHALLENGES}
            className="border border-charcoal/25 px-4 py-2 text-sm font-medium transition hover:border-charcoal/60 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <p className="mt-1 text-xs text-charcoal/50">
          {[...draft].length}/{MAX_CHALLENGE_TEXT}
        </p>
      </form>

      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Presets</span>
          {(Object.keys(CHALLENGE_PRESETS) as PresetSetKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPresetSet(key)}
              aria-pressed={presetSet === key}
              className={`px-3 py-1 text-xs font-medium ${
                presetSet === key ? 'bg-ink text-canvas' : 'border border-charcoal/25 text-charcoal'
              }`}
            >
              {CHALLENGE_PRESETS[key].label}
            </button>
          ))}
        </div>
        {presets.length === 0 ? (
          <p className="mt-2 text-sm text-charcoal/60">You&apos;ve added all of these.</p>
        ) : (
          <>
            <ul className="mt-2 flex flex-wrap gap-2">
              {presets.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    disabled={busy || activeCount >= MAX_ACTIVE_CHALLENGES}
                    onClick={() => void add([p])}
                    className="border border-charcoal/20 bg-canvas px-3 py-1.5 text-left text-xs transition hover:border-charcoal/50 disabled:opacity-50"
                  >
                    + {p}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={busy || activeCount + presets.length > MAX_ACTIVE_CHALLENGES}
              onClick={() => void add(presets)}
              className="mt-2 text-sm font-medium text-charcoal underline underline-offset-4 disabled:opacity-50"
            >
              Add all {presets.length}
            </button>
          </>
        )}
      </div>

      {note ? (
        <p className={`mt-3 text-sm ${note.ok ? 'text-green-700' : 'text-red-700'}`} role="status">
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
