/**
 * The interactive demo at /demo/try.
 *
 * A visitor plays both parts in sequence: they add a photo as a guest, find it
 * held for review, put the host's hat on to approve it, and then see it reach
 * the gallery and the venue screen. Moderation gates the appearance on purpose
 * — it is the feature a nervous couple actually worries about, and the only way
 * to show what it does is to make them wait for it.
 *
 * The visitor's photo NEVER LEAVES THEIR BROWSER. It is held as an object URL
 * and nothing is uploaded, which is why this file has no notion of a key, a
 * bucket, or an event id. That is a product decision as much as a technical
 * one: a public demo that accepted real uploads would be an unauthenticated
 * write endpoint with no host behind it, and the demo is more persuasive for
 * being able to promise the photo stays put.
 */

/** Where the visitor is in the walkthrough. */
export type DemoStep = 'add' | 'held' | 'gallery' | 'live';

/** In order. The page renders progress from this, so it is the one source. */
export const DEMO_STEPS: DemoStep[] = ['add', 'held', 'gallery', 'live'];

export interface DemoStepCopy {
  /** Which hat the visitor is wearing. */
  role: 'guest' | 'host';
  label: string;
  /** What is happening, in the second person. */
  blurb: string;
}

export const DEMO_STEP_COPY: Record<DemoStep, DemoStepCopy> = {
  add: {
    role: 'guest',
    label: 'Add a photo',
    blurb:
      'You just scanned the code at the table. No app, no account — pick a photo and it is in.',
  },
  held: {
    role: 'host',
    label: 'Approve it',
    blurb:
      'This event has moderation on, so your photo is waiting for the host. That is you now.',
  },
  gallery: {
    role: 'guest',
    label: 'See the gallery',
    blurb: 'Approved. It is in with everyone else’s, newest first.',
  },
  live: {
    role: 'guest',
    label: 'Watch it go live',
    blurb: 'And on the screen at the venue, cycling with the rest of the night.',
  },
};

/** The next step, or null at the end. */
export function nextStep(step: DemoStep): DemoStep | null {
  const at = DEMO_STEPS.indexOf(step);
  if (at < 0 || at >= DEMO_STEPS.length - 1) return null;
  return DEMO_STEPS[at + 1];
}

/** 1-based position, for "Step 2 of 4". */
export function stepNumber(step: DemoStep): number {
  const at = DEMO_STEPS.indexOf(step);
  return at < 0 ? 1 : at + 1;
}

/**
 * Whether the visitor's own photo is visible to guests yet.
 *
 * Mirrors the real rule in lib/mediaSource and the gallery: a photo held for
 * review is withheld from guests until the host releases it. Approving is what
 * flips this, which is the whole point of the walkthrough.
 */
export function visitorPhotoVisible(approved: boolean): boolean {
  return approved;
}

/** Bytes we will pull into memory for a preview. */
export const MAX_DEMO_IMAGE_BYTES = 25 * 1024 * 1024;

export type DemoFileCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether we can preview the file the visitor picked.
 *
 * Deliberately narrower than the real upload validator: the demo previews a
 * still and nothing else. Video would need a poster frame to sit in a grid and
 * a player on the slideshow, which is a lot of machinery to show a feature the
 * sample photos already demonstrate.
 *
 * This is not a security control — nothing is uploaded, and the file never
 * leaves the machine it is already on. It is here so a visitor who picks a
 * 200 MB video gets a sentence instead of a hung tab.
 */
export function checkDemoFile(file: {
  type: string;
  size: number;
  name: string;
}): DemoFileCheck {
  if (!file.type.startsWith('image/')) {
    return {
      ok: false,
      reason: 'Pick a photo for the demo — the sample gallery already shows how video looks.',
    };
  }
  if (file.size > MAX_DEMO_IMAGE_BYTES) {
    return {
      ok: false,
      reason: 'That photo is very large. Try a smaller one, or use a sample instead.',
    };
  }
  return { ok: true };
}
