import type { EventChallenge } from '@/lib/challenges/api';
import { challengesWithPhotos } from '@/lib/challenges/rules';

/**
 * Gallery filter chips: "All" plus one per challenge that has photos.
 * Renders nothing when no photo answers a challenge.
 */
export default function ChallengeChips({
  challenges,
  photos,
  selectedId,
  onSelect,
}: {
  challenges: EventChallenge[];
  photos: ReadonlyArray<{ challengeId?: string | null }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const withPhotos = challengesWithPhotos(challenges, photos);
  if (withPhotos.length === 0) return null;

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-4 py-1.5 text-sm transition ${
      active ? 'border-ink bg-ink text-canvas' : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
    }`;

  return (
    <div className="mb-6" role="group" aria-label="Filter by challenge">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <button type="button" onClick={() => onSelect(null)} aria-pressed={selectedId === null} className={chip(selectedId === null)}>
          All
        </button>
        {withPhotos.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            aria-pressed={selectedId === c.id}
            className={chip(selectedId === c.id)}
          >
            {c.text} <span className="opacity-60">{c.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
