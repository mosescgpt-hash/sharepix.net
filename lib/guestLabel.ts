/**
 * A stable label for a guest who did not type a name.
 *
 * The upload form has always told guests "if left blank, this browser gets a
 * reusable guest label". It did not: every unnamed upload was stored as
 * "Anonymous", so one person's six photos and six people's one photo each
 * looked identical — in the gallery, to the host, and to any attempt to count
 * how many people actually took part.
 *
 * This makes that sentence true. The first time a browser uploads to an event
 * without a name it mints something like "Guest 7K2Q" and keeps it, so the
 * same phone stays the same guest for the rest of that event.
 *
 * ## Scoped per event, deliberately
 *
 * The label is stored under the event id, so the same person at two different
 * events is two unrelated labels. A single browser-wide id would quietly build
 * a cross-event identifier for people who never made an account and were never
 * asked — that is a tracking cookie with a friendly name, and the product
 * promises guests they need no account.
 *
 * ## What it is worth
 *
 * It is a convenience, not a credential. It lives in the guest's own browser,
 * it is sent with the upload, and anyone who wants to send a different one can.
 * It makes honest counting possible; it does not make counting tamper-proof.
 * See lib/successfulEvent.ts for where that distinction matters.
 */

/** Unambiguous characters only: no O/0, I/1, or 5/S to misread aloud. */
const LABEL_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY2346789';
const LABEL_LENGTH = 4;

const storageKey = (eventId: string) => `sharepix.guest-label.${eventId}`;

/**
 * Random suffix from the browser's CSPRNG, falling back to Math.random.
 *
 * The fallback is fine here and would not be anywhere else in this codebase:
 * this label is a display convenience, not an event code or a token, so a
 * predictable one costs nothing. Refusing to mint a label because crypto was
 * unavailable would mean falling back to "Anonymous", which is the behaviour
 * this module exists to remove.
 */
function randomSuffix(): string {
  const size = LABEL_ALPHABET.length;
  let out = '';
  const crypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (crypto?.getRandomValues) {
    const bytes = new Uint8Array(LABEL_LENGTH);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) out += LABEL_ALPHABET[byte % size];
    return out;
  }
  for (let i = 0; i < LABEL_LENGTH; i += 1) {
    out += LABEL_ALPHABET[Math.floor(Math.random() * size)];
  }
  return out;
}

/** Whether a stored value still looks like one of ours. */
export function isGuestLabel(value: string | null | undefined): boolean {
  if (!value) return false;
  const match = /^Guest ([A-Z2-9]+)$/.exec(value.trim());
  if (!match) return false;
  return (
    match[1].length === LABEL_LENGTH &&
    [...match[1]].every((char) => LABEL_ALPHABET.includes(char))
  );
}

/** Mint a fresh label. Exported for tests; callers want `guestLabelFor`. */
export function mintGuestLabel(): string {
  return `Guest ${randomSuffix()}`;
}

/**
 * The label this browser uses for this event, minting and storing one on first
 * use.
 *
 * Every storage access is wrapped: `localStorage` throws outright in some
 * privacy modes rather than returning null, and an upload must never fail
 * because a guest has cookies locked down. When storage is unusable the guest
 * still gets a working label for this upload — it simply will not persist, so
 * they may appear as more than one contributor. Undercounting participation is
 * a cost; refusing a photo at a party is not acceptable.
 */
export function guestLabelFor(eventId: string): string {
  const key = storageKey(eventId);
  try {
    const stored = window.localStorage.getItem(key);
    if (isGuestLabel(stored)) return stored as string;
  } catch {
    return mintGuestLabel();
  }
  const label = mintGuestLabel();
  try {
    window.localStorage.setItem(key, label);
  } catch {
    // Non-fatal, for the reason above.
  }
  return label;
}
