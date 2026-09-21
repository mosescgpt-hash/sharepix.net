/**
 * A function's copy of the demo-upload rules.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so this
 * exists more than once. Everything below the header is byte-identical to
 * lib/demoUpload.ts and __tests__/demo-upload-function-copy.test.ts fails if it
 * drifts.
 *
 * The prefix and the TTL are the two that must never disagree: one copy decides
 * what the cleanup job may delete, and another decides what the page tells
 * somebody about their photo. A drift between them is either a promise broken
 * or a real event's photos swept.
 */

/** Everything a visitor uploads lives under this prefix and nowhere else. */
export const DEMO_PREFIX = 'demo/';

/**
 * How long a demo upload survives, in minutes.
 *
 * An hour: long enough to look around the page and show somebody, short enough
 * that nothing accumulates. `demo-cleanup` runs far more often than this, so
 * the real lifetime is closer to the stated one than a daily sweep could make
 * it.
 */
export const DEMO_TTL_MINUTES = 60;

/** How many photos one visitor may add. Enough to feel real, not a dump site. */
export const DEMO_MAX_UPLOADS = 3;

/**
 * The size ceiling for a demo upload, deliberately below the real one.
 *
 * A real guest may send 25 MB because their photo is their memory. A demo
 * upload is thrown away within the hour, so there is nothing to protect and no
 * reason to accept a file that large from an anonymous stranger.
 */
export const DEMO_MAX_BYTES = 12 * 1024 * 1024;

/** What the picker accepts. Photos only — see the header. */
export const DEMO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];

export const DEMO_ACCEPT_ATTRIBUTE = DEMO_ACCEPTED_TYPES.join(',');

/**
 * Whether a key belongs to the demo, and is therefore ephemeral and unserved.
 *
 * Used by the cleanup job to decide what it may delete and by the upload
 * sanitizer to decide what to skip mirroring. Anchored at the start: a key
 * like `events/demo/...` is a real event's photo and must not be swept.
 */
export function isDemoKey(key: string): boolean {
  return key.startsWith(DEMO_PREFIX);
}

/**
 * Where one visitor's upload goes.
 *
 * The session id is a random value the browser makes up and keeps for the
 * visit. It is not an identity and is never resolved to one — it exists so a
 * visitor's own uploads sit together, and so the per-visit cap has something
 * to count. It is deliberately not derived from anything about the person.
 *
 * The extension is taken from the declared type rather than the filename: a
 * filename is user input, and the only thing it is used for here is the last
 * few characters of a key.
 */
export function demoKeyFor(sessionId: string, type: string, index: number): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  const extension = extensionFor(type);
  return `${DEMO_PREFIX}${safeSession}/${Date.now()}-${index}.${extension}`;
}

function extensionFor(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/heic' || type === 'image/heif') return 'heic';
  return 'jpg';
}

/** A new session id. Random, meaningless, and thrown away with the tab. */
export function newDemoSessionId(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DemoRejection {
  ok: false;
  reason: string;
}

export interface DemoAcceptance {
  ok: true;
}

/**
 * Whether this file may be uploaded, and what to say if not.
 *
 * The server checks all of this again — `sanitize-upload` sniffs the real bytes
 * and deletes anything that lied. This exists to give somebody a readable
 * answer instead of a file that silently vanishes, which on a page selling
 * "this is easy" would be the worst possible impression.
 */
export function checkDemoFile(
  file: { type: string; size: number },
  alreadyUploaded: number,
): DemoAcceptance | DemoRejection {
  if (alreadyUploaded >= DEMO_MAX_UPLOADS) {
    return {
      ok: false,
      reason: `That is ${DEMO_MAX_UPLOADS} — enough to see how it works. Create an event for the real thing.`,
    };
  }
  if (!DEMO_ACCEPTED_TYPES.includes(file.type)) {
    // Named rather than implied: "unsupported file" leaves somebody guessing
    // whether their phone is the problem.
    return {
      ok: false,
      reason: 'The demo takes photos only — a real event takes video too.',
    };
  }
  if (file.size > DEMO_MAX_BYTES) {
    const mb = Math.round(DEMO_MAX_BYTES / (1024 * 1024));
    return {
      ok: false,
      reason: `That photo is over ${mb} MB. The demo caps it there; a real event allows more.`,
    };
  }
  return { ok: true };
}

/** When an upload made now will be swept. */
export function demoExpiresAt(uploadedAt: Date): Date {
  return new Date(uploadedAt.getTime() + DEMO_TTL_MINUTES * 60_000);
}

/** Whether the cleanup job should remove this object. */
export function isDemoExpired(uploadedAt: Date, now: Date): boolean {
  return now.getTime() >= demoExpiresAt(uploadedAt).getTime();
}

/**
 * What the page tells somebody about their photo, in plain words.
 *
 * Counts down so the promise is visibly being kept rather than asserted once
 * and forgotten. Rounds up, because saying "0 minutes" while a photo is still
 * on screen reads as broken.
 */
export function demoRetentionNote(expiresAt: Date, now: Date): string {
  const minutes = Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return 'Deleted.';
  if (minutes === 1) return 'Deleted in about a minute.';
  return `Deleted in about ${minutes} minutes.`;
}

/**
 * The promise printed next to the upload control.
 *
 * Kept here beside the TTL it describes, so the number in the sentence cannot
 * drift from the number the job enforces — the exact drift this repository has
 * been bitten by repeatedly.
 */
export const DEMO_PROMISE = `Your photo is uploaded the way a guest's would be, then deleted within ${
  DEMO_TTL_MINUTES === 60 ? 'the hour' : `${DEMO_TTL_MINUTES} minutes`
}. Nothing else can see it — there is no page anywhere that shows it, not even to us.`;
