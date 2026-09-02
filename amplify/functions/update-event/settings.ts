/**
 * Which of an event's fields its host may change, and to what.
 *
 * Pure functions, no SDK and no I/O, so the rules are unit tested directly and
 * still bundle into the Lambda — the same split as create-event/newEvent.ts.
 *
 * This is the other half of moving event creation server-side. Deriving the
 * plan, the limits and `paid` at creation buys nothing if the host can then
 * send `Event.update({ id, paid: true })` and activate a pending event for
 * free — the owner rule granted update on the whole row, every field of it,
 * including the counters createEventPhoto maintains and the dates the whole
 * retention lifecycle is measured from.
 *
 * So the Event model grants owners no `update` at all now, and this function is
 * the only way a host changes their event. The allow-list below is the entire
 * surface: a field that isn't named here cannot be written by a host through
 * any path. Admins keep model-level update, which is how the global-admin
 * dashboard grants extra capacity and moves an upload window.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Longest event name we store, matching the form's maxLength. */
export const MAX_EVENT_NAME = 80;

const MAX_CITY = 60;
const MAX_STATE = 40;
const MAX_ALERT_EMAIL = 254;

function collapse(value: string, maxLength: number): string {
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

function cleanLocationPart(value: string, maxLength: number): string {
  return value
    .replace(/[^\p{L}\p{N} .'\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** "Minneapolis, MN", or '' when neither part survives. Mirrors lib/eventLocation.ts. */
export function formatEventLocation(
  city: string | null | undefined,
  state: string | null | undefined,
): string {
  return [cleanLocationPart(city ?? '', MAX_CITY), cleanLocationPart(state ?? '', MAX_STATE)]
    .filter(Boolean)
    .join(', ');
}

/** A calendar date, or null when it isn't one. Mirrors create-event/newEvent.ts. */
export function sanitizeEventDate(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/** How uploads to an event are screened. Anything else is not a setting. */
export const MODERATION_MODES = ['review', 'allow_all'];

/**
 * What the request asked to change. An absent key means "leave it alone"; an
 * explicit null means "clear it". GraphQL distinguishes the two and the Amplify
 * client drops undefined properties, so this needs no sentinel values.
 */
export interface SettingsRequest {
  name?: string | null;
  date?: string | null;
  city?: string | null;
  state?: string | null;
  moderationMode?: string | null;
  alertEmail?: string | null;
  videoUploadsEnabled?: boolean | null;
  guestDownloadsBlocked?: boolean | null;
  uploadsClosed?: boolean | null;
}

/** The event as stored, insofar as these rules care. */
export interface EventState {
  /** Photos uploaded so far — what locks the name and date. */
  photoCount: number;
}

export interface Patch {
  /** Attributes to write, already cleaned. */
  set: Record<string, string | boolean>;
  /** Attributes to remove, for the fields a host can clear. */
  remove: string[];
}

export type PatchResult = { ok: true; patch: Patch } | { ok: false; reason: string };

/**
 * Turn a request into the exact attributes to write, or a reason not to.
 *
 * Every branch either produces a cleaned value or refuses. Nothing falls
 * through to "write what they sent".
 */
export function buildPatch(request: SettingsRequest, event: EventState): PatchResult {
  const set: Record<string, string | boolean> = {};
  const remove: string[] = [];

  // The name and date lock once guests have uploaded, so an event can't rename
  // itself underneath the people whose memories are in it. The client hides the
  // fields; this is what actually enforces it.
  const changingIdentity = request.name !== undefined || request.date !== undefined;
  if (changingIdentity && event.photoCount > 0) {
    return {
      ok: false,
      reason: 'This event already has photos, so its name and date are locked.',
    };
  }

  if (request.name !== undefined) {
    const name = collapse(request.name ?? '', MAX_EVENT_NAME);
    if (!name) return { ok: false, reason: 'Enter an event name.' };
    set.name = name;
  }

  if (request.date !== undefined) {
    const date = sanitizeEventDate(request.date);
    if (date) set.date = date;
    else if ((request.date ?? '').trim() === '') remove.push('date');
    else return { ok: false, reason: 'Enter the event date as a real calendar date.' };
  }

  // City and state arrive separately and are stored as one label, so either one
  // changing means rebuilding it from both.
  if (request.city !== undefined || request.state !== undefined) {
    const location = formatEventLocation(request.city, request.state);
    if (location) set.location = location;
    else remove.push('location');
  }

  if (request.moderationMode !== undefined) {
    const mode = (request.moderationMode ?? '').trim().toLowerCase();
    if (!MODERATION_MODES.includes(mode)) {
      return { ok: false, reason: 'Choose one of the available screening settings.' };
    }
    set.moderationMode = mode;
  }

  if (request.alertEmail !== undefined) {
    const email = collapse(request.alertEmail ?? '', MAX_ALERT_EMAIL);
    if (!email) {
      // Clearing it turns the alerts off; held photos stay reviewable in the
      // dashboard either way, so this is never destructive.
      remove.push('alertEmail');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, reason: 'Enter a valid email address.' };
    } else {
      set.alertEmail = email;
    }
  }

  for (const flag of ['videoUploadsEnabled', 'guestDownloadsBlocked', 'uploadsClosed'] as const) {
    const value = request[flag];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      return { ok: false, reason: 'That setting could not be updated.' };
    }
    set[flag] = value;
  }

  if (Object.keys(set).length === 0 && remove.length === 0) {
    return { ok: false, reason: 'Nothing to update.' };
  }

  return { ok: true, patch: { set, remove } };
}

/**
 * Whether this caller may change this event.
 *
 * Same rule as everywhere else: the owner string is "<sub>::<loginId>", so the
 * sub is compared against its first segment rather than by substring — a
 * substring match would let a sub that happens to contain another's through.
 */
export function mayEdit(
  caller: { sub?: string | null; groups?: string[] | null } | null | undefined,
  owner: string,
): boolean {
  if ((caller?.groups ?? [])?.includes('ADMINS')) return true;
  const sub = caller?.sub;
  if (!sub || !owner) return false;
  return owner.split('::')[0] === sub;
}

/**
 * The fields a host may write, as one list. Exported so a test can assert that
 * nothing priced, counted or dated has crept into it — the whole point of this
 * module is that the list stays short.
 */
export const EDITABLE_FIELDS = [
  'name',
  'date',
  'location',
  'moderationMode',
  'alertEmail',
  'videoUploadsEnabled',
  'guestDownloadsBlocked',
  'uploadsClosed',
];
