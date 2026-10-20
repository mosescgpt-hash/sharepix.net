import { useCallback, useEffect, useState } from 'react';
import {
  guideStorageKey,
  readGuideProgress,
  type GuideProgress,
  type GuideStep,
} from '@/lib/guidedSetup';

/**
 * Where the host is in the guide, remembered per event on this device (a
 * convenience, so a reload doesn't lose their place; nothing depends on it).
 */
export function useGuideProgress(eventId: string, steps: GuideStep[]) {
  const [progress, setProgress] = useState<GuideProgress>({ status: 'unseen' });

  useEffect(() => {
    try {
      setProgress(readGuideProgress(window.localStorage.getItem(guideStorageKey(eventId)), steps.length));
    } catch {
      setProgress({ status: 'unseen' });
    }
  }, [eventId, steps.length]);

  const save = useCallback(
    (next: GuideProgress) => {
      setProgress(next);
      try {
        window.localStorage.setItem(guideStorageKey(eventId), JSON.stringify(next));
      } catch {
        // Private browsing: the guide still works, it just won't remember.
      }
    },
    [eventId],
  );

  return [progress, save] as const;
}

/**
 * The guided customization banner at the top of the dashboard. It offers the
 * walkthrough to a host who hasn't seen it; while it runs, it shows one step at
 * a time and opens that step's card. Skip, Back and End guide are always there.
 */
export default function GuidedSetup({
  steps,
  progress,
  onProgress,
  onOpen,
  offer,
}: {
  steps: GuideStep[];
  progress: GuideProgress;
  onProgress: (next: GuideProgress) => void;
  /** Open a step's card: a DASHBOARD_JUMPS key. */
  onOpen: (jump: string) => void;
  /** Whether to offer the guide to a host who hasn't started it. */
  offer: boolean;
}) {
  const active = progress.status === 'active' ? progress : null;
  const step = active ? steps[active.step] : null;

  // Opening the card is the point of each step, so it happens on every move.
  useEffect(() => {
    if (step) onOpen(step.jump);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.jump]);

  if (steps.length === 0) return null;

  if (!active || !step) {
    if (progress.status !== 'unseen' || !offer) return null;
    return (
      <div className="mt-6 flex flex-col gap-3 border border-ink/15 bg-paper p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Not sure what to set up?</p>
          <p className="mt-0.5 text-sm text-charcoal/65">
            Guided customization walks you through each option in about three minutes. Skip
            anything, or stop at any time.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => onProgress({ status: 'active', step: 0 })}
            className="spx-btn-ink"
          >
            Start guided customization
          </button>
          <button
            type="button"
            onClick={() => onProgress({ status: 'dismissed' })}
            className="px-3 text-sm text-charcoal/65 underline"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  const last = active.step === steps.length - 1;
  return (
    <div
      role="region"
      aria-label="Guided customization"
      data-guide-banner
      className="sticky top-0 z-30 -mx-4 mt-6 border-b border-ink/15 bg-paper/95 px-4 py-3 shadow-sm backdrop-blur sm:mx-0 sm:border sm:px-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-charcoal/55">
          Guided customization · {active.step + 1} of {steps.length}
        </p>
        <button
          type="button"
          onClick={() => onProgress({ status: 'dismissed' })}
          className="text-xs text-charcoal/60 underline"
        >
          End guide
        </button>
      </div>
      <div
        className="mt-1 h-1 w-full bg-charcoal/10"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={active.step + 1}
      >
        <div className="h-1 bg-ink" style={{ width: `${((active.step + 1) / steps.length) * 100}%` }} />
      </div>
      <p className="mt-2 font-sans text-base font-bold">{step.title}</p>
      <p className="mt-0.5 text-sm text-charcoal/70">{step.why}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onProgress({ status: 'active', step: active.step - 1 })}
          disabled={active.step === 0}
          className="border border-charcoal/25 px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onProgress(last ? { status: 'done' } : { status: 'active', step: active.step + 1 })}
          className="spx-btn-ink"
        >
          {last ? 'Finish' : 'Next'}
        </button>
        {!last ? (
          <button
            type="button"
            onClick={() => onProgress({ status: 'active', step: active.step + 1 })}
            className="px-2 text-sm text-charcoal/65 underline"
          >
            Skip this one
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onOpen(step.jump)}
          className="ml-auto px-2 text-sm text-pine underline"
        >
          Show me again
        </button>
      </div>
    </div>
  );
}
