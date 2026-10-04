import { useEffect, useState } from 'react';
import type { EventChallenge } from '@/lib/challenges/api';
import { activeChallenges, pickChallenge } from '@/lib/challenges/rules';

/**
 * "Try a challenge" on the upload page: one random prompt, "Another one" to
 * reshuffle, and "Take this photo" to open the camera with the prompt attached.
 *
 * Never in the way: the normal upload form sits right below and needs nothing
 * from this. Renders nothing when the event has no active challenges.
 */
export default function ChallengeCard({
  challenges,
  selected,
  onSelect,
}: {
  challenges: EventChallenge[];
  /** The challenge the next upload will answer, if the guest chose one. */
  selected: EventChallenge | null;
  onSelect: (challenge: EventChallenge | null) => void;
}) {
  const active = activeChallenges(challenges);
  const [current, setCurrent] = useState<EventChallenge | null>(null);

  // Picked after mount, not during render, so the server and first client
  // render agree and the prompt doesn't flicker.
  useEffect(() => {
    setCurrent((prev) => (prev && active.some((c) => c.id === prev.id) ? prev : pickChallenge(active)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenges]);

  if (active.length === 0) return null;

  if (selected) {
    return (
      <div className="spx-card mb-6 p-5" aria-live="polite">
        <p className="spx-eyebrow">Your challenge</p>
        <p className="spx-display-serif mt-1 text-2xl">{selected.text}</p>
        <p className="mt-2 text-sm text-charcoal/70">
          The photos you upload next are filed under it.
        </p>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="mt-3 text-sm font-medium text-charcoal/70 underline underline-offset-4"
        >
          Upload without a challenge
        </button>
      </div>
    );
  }

  if (!current) return null;

  const take = () => {
    onSelect(current);
    // Same tap, so the browser allows it: open the camera the form already has.
    document.getElementById('photo-camera-input')?.click();
  };

  return (
    <div className="spx-card mb-6 p-5">
      <p className="spx-eyebrow">Try a challenge</p>
      <p className="spx-display-serif mt-1 text-2xl" aria-live="polite">
        {current.text}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={take} className="spx-btn-ink">
          Take this photo
        </button>
        {active.length > 1 ? (
          <button
            type="button"
            onClick={() => setCurrent(pickChallenge(active, current.id))}
            className="spx-btn-outline"
          >
            Another one
          </button>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-charcoal/55">Optional. You can upload anything below.</p>
    </div>
  );
}
