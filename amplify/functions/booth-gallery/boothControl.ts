/**
 * Booth start and stop codes (docs/booth-mode.md, "Start and stop codes").
 *
 * The host prints them from the Booth tab. Photographed in the photo stream
 * (or scanned live), they say where the FOLLOWING photos go:
 *
 *   event start     → the event's general photos
 *   category start  → that category's general photos (a day, a session…)
 *   person code     → that person (the SPB1 code from the kiosk or sign-up)
 *   stop            → nowhere: held as "Stopped (not sent)" for the host
 *
 * Payload: `SPK1.<kind>.<id>.<mac>`, kind `e` (event), `c` (category) or `s`
 * (stop); id is the category id, or `-`. mac is HMAC-SHA-256 over
 * `SPK1|<eventId>|<kind>|<id>`, first 16 bytes, base64url. The key is derived
 * from the server-only BOOTH_PRIVATE_KEY, so only SharePix can make a code,
 * and a code only verifies for its own event. The event id is not in the code
 * (the upload says which event it is), which keeps it small.
 *
 * Shared, byte-identical, in process-pro-photo, booth-scan and booth-gallery
 * (Amplify functions take no cross-bundle imports; a test enforces it).
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export const CONTROL_PREFIX = 'SPK1.';
const INFO = 'sharepix-booth-control-v1';

export type ControlKind = 'e' | 'c' | 's';

export interface ControlCode {
  kind: ControlKind;
  /** Category id for `c`, otherwise '-'. */
  id: string;
}

/** A category id: 8 base64url characters. */
export function isCategoryId(id: string): boolean {
  return /^[A-Za-z0-9_-]{8}$/.test(id);
}

export const MAX_CATEGORIES = 30;
export const MAX_CATEGORY_NAME = 40;

/** A category name, trimmed and checked, or null when it is not usable. */
export function cleanCategoryName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name || name.length > MAX_CATEGORY_NAME) return null;
  return name;
}

function controlKey(secret: string): Buffer {
  if (!secret) throw new Error('Booth codes are not set up.');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret.replace(/\s+/g, '')), Buffer.alloc(0), INFO, 32));
}

function mac(secret: string, eventId: string, code: ControlCode): string {
  return createHmac('sha256', controlKey(secret))
    .update(`SPK1|${eventId}|${code.kind}|${code.id}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

/** The QR text for a start or stop code. Server only. */
export function makeControlCode(secret: string, eventId: string, code: ControlCode): string {
  if (code.kind === 'c' ? !isCategoryId(code.id) : code.id !== '-') throw new Error('Bad booth code.');
  return `${CONTROL_PREFIX}${code.kind}.${code.id}.${mac(secret, eventId, code)}`;
}

/** Whether this text looks like a start/stop code at all (not whether it is genuine). */
export function isControlPayload(text: string): boolean {
  return text.trim().startsWith(CONTROL_PREFIX);
}

/**
 * The start/stop code this text is, if it is genuine for THIS event. A code
 * from another event, a changed code or a made-up one returns null.
 */
export function readControlCode(secret: string, eventId: string, text: string): ControlCode | null {
  const parts = text.trim().split('.');
  if (parts.length !== 4 || `${parts[0]}.` !== CONTROL_PREFIX) return null;
  const [, kind, id, given] = parts;
  if (kind !== 'e' && kind !== 'c' && kind !== 's') return null;
  const code: ControlCode = { kind, id };
  if (kind === 'c' ? !isCategoryId(id) : id !== '-') return null;
  if (!secret) return null;
  const want = Buffer.from(mac(secret, eventId, code));
  const got = Buffer.from(given ?? '');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return code;
}

// ---------------------------------------------------------------------------
// The sequence: what each scan means for the photos after it. Pure.

/** One scan in the stream, in the order it was taken. */
export type Marker =
  | { kind: 'event' }
  | { kind: 'category'; categoryId: string; categoryName: string }
  | { kind: 'stop' }
  | { kind: 'person'; attendeeId: string; name: string }
  /** A code that could not be read or is from another event: ends the run, goes nowhere. */
  | { kind: 'unreadable' };

/** Where the photos after a scan go. */
export type Destination =
  | { to: 'event' }
  | { to: 'category'; categoryId: string; categoryName: string }
  | { to: 'person'; attendeeId: string; name: string; categoryId: string | null; categoryName: string | null }
  | { to: 'stopped' }
  | { to: 'nobody' };

/** The session state between scans: which event part is running. */
export interface SessionState {
  /** null before any start code, or after stop. */
  part: { categoryId: string | null; categoryName: string | null } | null;
  stopped: boolean;
}

export const START_STATE: SessionState = { part: null, stopped: false };

/**
 * Apply one scan. The rules (also in docs/booth-mode.md):
 * - event start: following photos are the event's general photos.
 * - category start: following photos are that category's general photos.
 * - person: following photos go to that person. If a category is running they
 *   are also labelled with it. A person code works while stopped too (it
 *   resumes, for that person), because scanning someone is a clear signal.
 * - stop: following photos are held as "Stopped", never sent, until a start
 *   code or a person code.
 * - unreadable: following photos go to nobody until the next good code.
 */
export function step(state: SessionState, marker: Marker): { state: SessionState; dest: Destination } {
  switch (marker.kind) {
    case 'event':
      return { state: { part: { categoryId: null, categoryName: null }, stopped: false }, dest: { to: 'event' } };
    case 'category':
      return {
        state: { part: { categoryId: marker.categoryId, categoryName: marker.categoryName }, stopped: false },
        dest: { to: 'category', categoryId: marker.categoryId, categoryName: marker.categoryName },
      };
    case 'stop':
      return { state: { part: null, stopped: true }, dest: { to: 'stopped' } };
    case 'person':
      return {
        state: { part: state.part, stopped: false },
        dest: {
          to: 'person',
          attendeeId: marker.attendeeId,
          name: marker.name,
          categoryId: state.part?.categoryId ?? null,
          categoryName: state.part?.categoryName ?? null,
        },
      };
    default:
      return { state, dest: { to: 'nobody' } };
  }
}

/** Run a whole stream: each item is a scan or a photo. Returns each photo's destination. */
export function routeStream(
  items: readonly ({ scan: Marker } | { photo: string })[],
): Map<string, Destination> {
  let state = START_STATE;
  let dest: Destination = { to: 'nobody' };
  const out = new Map<string, Destination>();
  for (const item of items) {
    if ('scan' in item) ({ state, dest } = step(state, item.scan));
    else out.set(item.photo, dest);
  }
  return out;
}

// How scans are stored on a BoothScan row (attendeeId), so the processor can
// rebuild the marker. Person scans keep the attendee id itself.
export const MARK_EVENT = 'ctl:event';
export const MARK_STOP = 'ctl:stop';
export const MARK_CATEGORY = 'ctl:cat:';

export function markerToScanId(marker: Marker): string | null {
  if (marker.kind === 'event') return MARK_EVENT;
  if (marker.kind === 'stop') return MARK_STOP;
  if (marker.kind === 'category') return `${MARK_CATEGORY}${marker.categoryId}`;
  if (marker.kind === 'person') return marker.attendeeId;
  return null;
}

/** The label stored next to a scan, for the host's screens. */
export function markerLabel(marker: Marker): string {
  if (marker.kind === 'event') return 'Event start';
  if (marker.kind === 'stop') return 'Stop';
  if (marker.kind === 'category') return `Start: ${marker.categoryName}`;
  if (marker.kind === 'person') return marker.name;
  return 'Unreadable code';
}

/**
 * A stored scan row back to its destination. `context` is the category the
 * row recorded as running when a person was scanned.
 */
export function destinationOfScan(row: {
  attendeeId: string;
  name: string;
  categoryId?: string | null;
  categoryName?: string | null;
}): Destination {
  const id = row.attendeeId;
  if (id === MARK_EVENT) return { to: 'event' };
  if (id === MARK_STOP) return { to: 'stopped' };
  if (id.startsWith(MARK_CATEGORY)) {
    return { to: 'category', categoryId: id.slice(MARK_CATEGORY.length), categoryName: row.categoryName ?? row.name.replace(/^Start: /, '') };
  }
  if (id === 'none') return { to: 'nobody' };
  return { to: 'person', attendeeId: id, name: row.name, categoryId: row.categoryId ?? null, categoryName: row.categoryName ?? null };
}

/** The session state a stored scan leaves behind (for the next person scan's category). */
export function stateAfterScan(dest: Destination, before: SessionState): SessionState {
  if (dest.to === 'event') return { part: { categoryId: null, categoryName: null }, stopped: false };
  if (dest.to === 'category') return { part: { categoryId: dest.categoryId, categoryName: dest.categoryName }, stopped: false };
  if (dest.to === 'stopped') return { part: null, stopped: true };
  if (dest.to === 'person') {
    return { part: dest.categoryId ? { categoryId: dest.categoryId, categoryName: dest.categoryName } : before.part ?? { categoryId: null, categoryName: null }, stopped: false };
  }
  return before;
}

/**
 * Photo row fields for a destination: boothMatch, recipients, and the event
 * part. Plain values; the processor turns them into DynamoDB attributes.
 */
export function photoFieldsFor(dest: Destination): {
  boothMatch: string;
  boothSegment: 'event' | 'category' | 'person' | 'stopped' | 'unsorted';
  attendeeIds: string[];
  attendeeNames: string[];
  categoryId: string | null;
  categoryName: string | null;
} {
  switch (dest.to) {
    case 'event':
      return { boothMatch: 'event', boothSegment: 'event', attendeeIds: [], attendeeNames: [], categoryId: null, categoryName: null };
    case 'category':
      return { boothMatch: 'event', boothSegment: 'category', attendeeIds: [], attendeeNames: [], categoryId: dest.categoryId, categoryName: dest.categoryName };
    case 'person':
      return { boothMatch: 'qr', boothSegment: 'person', attendeeIds: [dest.attendeeId], attendeeNames: [dest.name], categoryId: dest.categoryId, categoryName: dest.categoryName };
    case 'stopped':
      return { boothMatch: 'stopped', boothSegment: 'stopped', attendeeIds: [], attendeeNames: [], categoryId: null, categoryName: null };
    default:
      return { boothMatch: 'unassigned', boothSegment: 'unsorted', attendeeIds: [], attendeeNames: [], categoryId: null, categoryName: null };
  }
}

/** Categories as stored on the event row (JSON). Anything malformed is dropped. */
export function parseCategories(raw: unknown): { id: string; name: string }[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: { id: string; name: string }[] = [];
  for (const c of list) {
    const id = (c as { id?: unknown })?.id;
    const name = cleanCategoryName((c as { name?: unknown })?.name);
    if (typeof id === 'string' && isCategoryId(id) && name && !out.some((o) => o.id === id)) out.push({ id, name });
  }
  return out.slice(0, MAX_CATEGORIES);
}

// ---------------------------------------------------------------------------
// Guest uploads (a scanned guest adding their own photos). Pure rules.

export const MAX_GUEST_UPLOADS = 50;
/** Decoded bytes. The page shrinks photos to 2000 px before sending. */
export const MAX_GUEST_UPLOAD_BYTES = 700 * 1024;

export type GuestUploadRefusal = 'not-scanned' | 'closed' | 'limit' | 'bad-file';

export const GUEST_UPLOAD_MESSAGES: Record<GuestUploadRefusal, string> = {
  'not-scanned': 'You can add photos once the event has started.',
  closed: 'Uploads for this event are closed. Thanks for sharing!',
  limit: 'You have added the most photos allowed for this event. Thanks!',
  'bad-file': 'That file could not be used. Try a JPEG photo.',
};

/** Whether a guest may add a photo now, or why not. */
export function guestUploadRefusal(input: {
  sessionAt: string | null;
  /** A start code (event or category) has been scanned at this event. */
  eventStarted?: boolean;
  uploadsClosed: boolean;
  count: number;
  bytes: Buffer | null;
}): GuestUploadRefusal | null {
  if (input.uploadsClosed) return 'closed';
  if (!input.sessionAt && !input.eventStarted) return 'not-scanned';
  if (input.count >= MAX_GUEST_UPLOADS) return 'limit';
  const b = input.bytes;
  if (!b || b.length < 100 || b.length > MAX_GUEST_UPLOAD_BYTES) return 'bad-file';
  if (b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return 'bad-file';
  return null;
}

/** Whether a scan starts the event (opens guest uploads for every guest with a code). */
export function startsEvent(dest: Destination): boolean {
  return dest.to === 'event' || dest.to === 'category';
}

/**
 * Whether the event's guest uploads are closed after a scan. Stop closes
 * them; a start code reopens them only if a stop (not the host) closed them.
 */
export function uploadsAfterScan(
  current: { closed: boolean; by: 'host' | 'stop' | null },
  dest: Destination,
): { closed: boolean; by: 'host' | 'stop' | null } {
  if (dest.to === 'stopped') return current.by === 'host' ? current : { closed: true, by: 'stop' };
  if ((dest.to === 'event' || dest.to === 'category') && current.by === 'stop') return { closed: false, by: null };
  return current;
}
