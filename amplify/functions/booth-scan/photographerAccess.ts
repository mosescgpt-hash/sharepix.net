/**
 * Who may photograph an event, and who decided.
 *
 * The rule this module exists to enforce, in one sentence: **a photographer
 * can only reach an event a host put them on.** Everything else here is
 * bookkeeping around that.
 *
 * ## Why there is no PHOTOGRAPHERS group
 *
 * The obvious design is a Cognito group, and it is the wrong one. A group
 * answers "is this person a photographer at all", which is not a question
 * anything needs the answer to — the question that decides whether bytes may
 * be written is "did the host of *this* event authorize *this* person", and a
 * group cannot answer it. Adding one would mean a user-pool change, a manual
 * admin step before anyone could try the product, and a permission that looks
 * like authority while granting none.
 *
 * So: anyone signed in may create a PhotographerProfile, which costs nothing
 * and grants nothing. Reaching an event requires a row in EventPhotographer
 * that a host created, and that row is checked server-side on every write.
 *
 * ## The invariant that matters
 *
 * A photographer must never be able to authorize themselves. That means the
 * connection row's lifecycle is split across two parties who can each do
 * exactly one thing:
 *
 *   host invites          → `invited`
 *   photographer accepts  → `accepted`   (only from `invited`, only by them)
 *   photographer declines → `declined`
 *   host removes          → `removed`    (from anywhere, any time)
 *
 * Nobody can create an `accepted` row. `canTransition` is half the guard and
 * `actorMay` is the other half — a transition that is legal in the abstract is
 * still refused when the wrong party asks for it. Both are checked in the
 * Lambda, not in the browser.
 *
 * ## Removal is immediate and total
 *
 * A host who removes a photographer mid-event has almost certainly just had a
 * reason to. Removal stops uploads, stops review, and stops publishing on the
 * next check — it does not wait for a session to expire. Already-published
 * photos stay up: they were published with permission, and yanking a gallery
 * out from under guests mid-reception is its own incident. Un-publishing is a
 * separate, deliberate action.
 */

export const CONNECTION_STATUSES = ['invited', 'accepted', 'declined', 'removed'] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export function isConnectionStatus(value: unknown): value is ConnectionStatus {
  return typeof value === 'string' && (CONNECTION_STATUSES as readonly string[]).includes(value);
}

/** Who is asking. The Lambda derives this from the token, never from the request body. */
export type Actor = 'host' | 'photographer' | 'admin';

const ALLOWED_TRANSITIONS: Record<ConnectionStatus, readonly ConnectionStatus[]> = {
  invited: ['accepted', 'declined', 'removed'],
  // An accepted connection can be ended by either side.
  accepted: ['removed', 'declined'],
  // Re-inviting someone who declined is a fresh invitation, which is the host
  // acting again rather than a status flip on a row they already answered.
  declined: ['invited'],
  removed: ['invited'],
};

export function canTransition(from: ConnectionStatus, to: ConnectionStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Whether this party may make this transition.
 *
 * The half of the guard that stops self-authorization. `invited → accepted` is
 * a legal transition, and a host performing it on their own event would be
 * adding a photographer who never agreed; a photographer performing
 * `removed → invited` would be re-admitting themselves after being thrown out.
 * Both are refused here.
 */
export function actorMay(actor: Actor, from: ConnectionStatus, to: ConnectionStatus): boolean {
  if (!canTransition(from, to)) return false;
  // An admin can do anything a host can, for support. Never anything only the
  // photographer can do: accepting on someone's behalf fabricates consent.
  const asHost = actor === 'host' || actor === 'admin';

  switch (to) {
    case 'invited':
      return asHost;
    case 'accepted':
      // Only the invited photographer, and only themselves.
      return actor === 'photographer';
    case 'declined':
      return actor === 'photographer';
    case 'removed':
      // Either side may end it. A photographer walking away from an event is
      // not something a host should have to agree to.
      return asHost || actor === 'photographer';
    default:
      return false;
  }
}

export interface Connection {
  eventId?: string | null;
  photographerId?: string | null;
  status?: string | null;
}

/**
 * Whether this connection lets its photographer write to this event.
 *
 * Deliberately takes the event id as a separate argument and compares it: the
 * caller has a row fetched by some key and an event it means to act on, and
 * this is the place those two are checked to be the same. A function that
 * trusted the row to be for the right event would be one `getItem` typo away
 * from cross-event access.
 */
export function mayUploadToEvent(
  connection: Connection | null | undefined,
  eventId: string,
  photographerId: string,
): boolean {
  if (!connection) return false;
  if (!eventId || !photographerId) return false;
  if (connection.eventId !== eventId) return false;
  if (connection.photographerId !== photographerId) return false;
  // Only accepted. `invited` is an offer nobody took up yet.
  return connection.status === 'accepted';
}

/**
 * Whether this connection lets its photographer review and publish here.
 *
 * The same rule as uploading, on purpose and not by accident: a photographer
 * who may put photos into an event may decide which of their own photos are
 * shown, and one who may not do the first may not do the second. Kept as its
 * own function because "these are the same today" is a fact about now, and the
 * next person to change one should have to notice they are changing both.
 */
export function mayReviewEvent(
  connection: Connection | null | undefined,
  eventId: string,
  photographerId: string,
): boolean {
  return mayUploadToEvent(connection, eventId, photographerId);
}

/** The row id that makes one photographer's connection to one event unique. */
export function connectionId(eventId: string, photographerId: string): string {
  return `${eventId}#${photographerId}`;
}

/**
 * How long a pairing code is good for.
 *
 * Short, because a pairing code is a bearer credential: anyone holding it can
 * attach themselves to an event. Long enough for a photographer to read it off
 * a host's screen, or for a future Bridge device to scan it and finish setup
 * on venue wifi.
 */
export const PAIRING_CODE_TTL_MINUTES = 30;

/** Characters a pairing code is drawn from. No 0/O/1/I — these get read aloud. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PAIRING_CODE_LENGTH = 8;

/**
 * Whether a pairing code is still usable.
 *
 * Expiry is checked against the row's own timestamp rather than a countdown
 * held anywhere, so a paused laptop or a device with a wrong clock cannot
 * extend one. `usedAt` makes it single-use: a code that attached one
 * photographer must not attach a second.
 */
export function pairingCodeUsable(
  code: { expiresAt?: string | null; usedAt?: string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!code) return false;
  if (code.usedAt) return false;
  const expires = Date.parse(code.expiresAt ?? '');
  // An unparseable expiry is treated as expired. A bearer credential we cannot
  // date is one we refuse, never one we accept.
  if (!Number.isFinite(expires)) return false;
  return now.getTime() < expires;
}

/**
 * Format a pairing code for display: `ABCD-EFGH`.
 *
 * Grouped because it gets read aloud across a room, and an unbroken run of
 * eight characters is where people lose their place.
 */
export function formatPairingCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

/** Accept a code however it was typed: spaces, dashes, lower case. */
export function normalizePairingCode(input: string | null | undefined): string {
  return (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PAIRING_CODE_LENGTH);
}
