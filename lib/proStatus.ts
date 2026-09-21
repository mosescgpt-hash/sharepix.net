/**
 * What a photographer is looking at, in words, in one place.
 *
 * ## Why this is a module and not copy in two components
 *
 * There are exactly two states — paused and live — and before this they were
 * described differently on each page. The event list said "Review · paused",
 * which names the state without saying what it costs; the review page said
 * "nothing reaches the gallery until you go live", which explains it. A
 * photographer moving between the two had to work out they were the same thing.
 *
 * Worse, the list gave no hint that paused is the *default*. Somebody could
 * shoot a whole ceremony, approve everything, and never learn that the couple
 * had seen none of it.
 *
 * So both pages read from here. The state has one name and one explanation
 * wherever it appears.
 *
 * ## The three steps
 *
 * The feature has a shape that is obvious once you know it and invisible until
 * then: upload, approve, publish. Three nouns, three verbs, said once at the
 * top of the section rather than inferred from four queue tabs.
 */

/** The whole feature, in the order it happens. */
export const PRO_STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: 'Upload',
    detail:
      'Send shots from your camera or phone. We make a reduced-resolution preview for the gallery.',
  },
  {
    title: 'Approve',
    detail: 'Look through what arrived and pick the ones worth showing. Nothing is automatic.',
  },
  {
    title: 'Publish',
    detail:
      'Go live and approved shots appear in the couple’s gallery within minutes. Until then nobody sees them.',
  },
];

export interface LiveState {
  /** Short enough for a chip beside an event name. */
  badge: string;
  /** What this state means for the people at the event. One sentence. */
  meaning: string;
  /** What the button does next. */
  action: string;
}

/**
 * The two states, described the same way everywhere.
 *
 * `meaning` is written from the guest's side rather than the system's — "the
 * gallery is showing your approved shots", not "livePublishing is true".
 * Whether a photograph is visible to the couple is the only thing the flag
 * actually decides, and it is what a photographer is asking.
 */
export function liveState(live: boolean): LiveState {
  return live
    ? {
        badge: 'Live',
        meaning: 'The gallery is showing everything you approve, within minutes.',
        action: 'Pause publishing',
      }
    : {
        badge: 'Paused',
        meaning: 'Nothing you approve is visible to anyone yet. Go live when you are ready.',
        action: 'Go live',
      };
}

/** The queues, in the order a photo moves through them. */
export const PRO_QUEUES: ReadonlyArray<{ key: string; label: string; empty: string }> = [
  {
    key: 'awaiting_review',
    label: 'To review',
    empty: 'Nothing waiting. Uploaded shots land here first.',
  },
  {
    key: 'approved',
    label: 'Approved',
    empty: 'Nothing approved yet.',
  },
  // 'published' is the stored status; "In the gallery" is what it means to a
  // photographer, who does not care what the column is called.
  { key: 'published', label: 'In the gallery', empty: 'Nothing in the gallery yet.' },
  { key: 'rejected', label: 'Rejected', empty: 'Nothing rejected.' },
];

/**
 * How an invitation that is not yet usable should read.
 *
 * A photographer sees the raw status otherwise — "invited", "removed" — which
 * are database words. Each of these says what the photographer should do about
 * it, because a state with no next action is just a thing to worry about.
 */
export function connectionState(status: string): { label: string; detail: string } {
  if (status === 'invited') {
    return {
      label: 'Waiting for you',
      detail: 'The host invited you. Use the pairing code they sent to accept.',
    };
  }
  if (status === 'removed') {
    return {
      label: 'No longer shooting this',
      detail: 'The host removed you from this event. Anything already published stays.',
    };
  }
  return { label: status || 'Unknown', detail: '' };
}

/**
 * What to call an event whose name could not be read.
 *
 * The list showed a raw UUID, because the connection row carries an event id
 * and nothing else. The name is now fetched — but an event can be deleted while
 * a connection to it survives, and a bare id on screen tells a photographer
 * nothing at all. This at least says what happened.
 */
export const EVENT_NAME_UNAVAILABLE = 'Event no longer available';

export function eventLabel(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed || EVENT_NAME_UNAVAILABLE;
}
