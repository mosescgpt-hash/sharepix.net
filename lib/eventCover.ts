/**
 * The cover at the top of an event's pages: a host's own photo or a ready-made
 * background, with the event's headline over it.
 *
 * ## Why this exists
 *
 * Every event opened on the same navy band. Hosts comparing SharePix with other
 * wedding apps liked one thing in particular: the couple's own photo behind
 * their names on the page guests land on. This is that, plus enough control
 * that a host who cares can make it theirs, without making the host who does
 * not care choose anything at all.
 *
 * ## Easy by default, more if you want it
 *
 * The simple path is two decisions, both optional: a photo or a background,
 * and (via a starter look) the fonts and colour that go with it. Everything
 * else — the headline wording, where the photo is anchored, how dark the shade
 * over it is, alignment, height and the countdown — has a default that is
 * right for most events and sits behind "More options".
 *
 * ## Always readable
 *
 * The host picks a background; the text colour follows from it and is never a
 * separate choice. Dark presets carry white text, the light ones (ivory,
 * cream) carry dark ink, and a test checks every preset against WCAG AA for
 * its own text colour. A photo always carries white text over a shade of at
 * least MIN_SHADE. A host can make the shade lighter, never absent: a white
 * dress and a white headline is a page nobody can read, and the host would
 * only find out from a guest.
 *
 * ## One stored value, validated twice
 *
 * The whole style is one JSON string on the event (`coverStyle`). The
 * update-event function parses it with `sanitizeCoverStyle` and stores the
 * cleaned version, so nothing the browser invents is kept; the pages parse it
 * again with `resolveEventCover`, so a stale or hand-edited value still renders
 * as something sensible rather than as an error.
 *
 * Duplicated byte-for-byte into amplify/functions/update-event/eventCover.ts,
 * which cannot import from lib/. `__tests__/event-cover.test.ts` pins the copy.
 */

/** A ready-made background: a CSS gradient, no image to download. */
export interface CoverPreset {
  key: string;
  label: string;
  /** The background itself. Only ever built from the constants below. */
  background: string;
  /**
   * Which way the words go. 'dark' backgrounds carry white text; 'light' ones
   * (ivory, cream) carry the page's dark ink.
   */
  tone: 'dark' | 'light';
  /**
   * The colour in the background that is closest to the text colour — the
   * lightest stop of a dark preset, the darkest of a light one. The text has to
   * clear AA against it, and a test checks that it does.
   */
  textAgainst: string;
}

export const COVER_PRESETS: CoverPreset[] = [
  {
    key: 'navy',
    label: 'SharePix navy',
    background: '#123851',
    tone: 'dark',
    textAgainst: '#123851',
  },
  {
    key: 'midnight',
    label: 'Midnight',
    background: 'linear-gradient(160deg, #0f1b2d 0%, #22304a 100%)',
    tone: 'dark',
    textAgainst: '#22304a',
  },
  {
    key: 'rose',
    label: 'Rose',
    background: 'linear-gradient(150deg, #6d2e46 0%, #a14a63 100%)',
    tone: 'dark',
    textAgainst: '#a14a63',
  },
  {
    key: 'sage',
    label: 'Sage',
    background: 'linear-gradient(150deg, #2f4a3a 0%, #557560 100%)',
    tone: 'dark',
    textAgainst: '#557560',
  },
  {
    key: 'champagne',
    label: 'Champagne',
    background: 'linear-gradient(150deg, #4a3a22 0%, #7a6038 100%)',
    tone: 'dark',
    textAgainst: '#7a6038',
  },
  {
    key: 'ocean',
    label: 'Ocean',
    background: 'linear-gradient(160deg, #0d3b4f 0%, #16657a 100%)',
    tone: 'dark',
    textAgainst: '#16657a',
  },
  {
    key: 'plum',
    label: 'Plum',
    background: 'linear-gradient(150deg, #3b1f4a 0%, #6b3f7d 100%)',
    tone: 'dark',
    textAgainst: '#6b3f7d',
  },
  {
    key: 'sunset',
    label: 'Sunset',
    background: 'linear-gradient(140deg, #5b2333 0%, #9a3f2f 100%)',
    tone: 'dark',
    textAgainst: '#9a3f2f',
  },
  {
    key: 'ivory',
    label: 'Ivory',
    background: 'linear-gradient(170deg, #fdfbf6 0%, #f4eddf 100%)',
    tone: 'light',
    textAgainst: '#f4eddf',
  },
  {
    key: 'cream',
    label: 'Cream',
    background:
      'radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.7) 0%, transparent 60%), linear-gradient(170deg, #f8f1e3 0%, #ecdfc6 100%)',
    tone: 'light',
    textAgainst: '#ecdfc6',
  },
  {
    key: 'confetti',
    label: 'Confetti',
    background:
      'radial-gradient(circle at 12% 20%, rgba(255,214,102,0.35) 0 3px, transparent 4px), radial-gradient(circle at 78% 30%, rgba(255,140,170,0.35) 0 3px, transparent 4px), radial-gradient(circle at 40% 75%, rgba(120,200,255,0.35) 0 3px, transparent 4px), radial-gradient(circle at 88% 82%, rgba(160,230,170,0.35) 0 3px, transparent 4px), #1d2440',
    tone: 'dark',
    textAgainst: '#1d2440',
  },
];

export const DEFAULT_COVER_PRESET = 'navy';

export const COVER_ALIGNMENTS = ['center', 'left'] as const;
export type CoverAlign = (typeof COVER_ALIGNMENTS)[number];

export const COVER_HEIGHTS = ['compact', 'standard', 'tall'] as const;
export type CoverHeight = (typeof COVER_HEIGHTS)[number];

/** The shade over a photo, in percent. Never below MIN_SHADE — see above. */
export const MIN_SHADE = 25;
export const MAX_SHADE = 80;
export const DEFAULT_SHADE = 45;

export const MAX_COVER_TITLE = 80;
export const MAX_COVER_SUBTITLE = 120;

/** Exactly what is stored. Every field optional; absent means the default. */
export interface CoverStyle {
  /** `events/<eventId>/cover/<id>.jpg`, uploaded by the host. */
  image?: string;
  /** A COVER_PRESETS key, used when there is no image. */
  preset?: string;
  /** Vertical anchor of the photo, 0 (top) to 100 (bottom). */
  focus?: number;
  /** Shade over the photo, MIN_SHADE to MAX_SHADE percent. */
  shade?: number;
  /** Headline instead of the event name. */
  title?: string;
  /** A line under it, e.g. "June 14 · Minneapolis". */
  subtitle?: string;
  align?: CoverAlign;
  height?: CoverHeight;
  /** Show "3 days to go" / "1d 19h left to share". On by default. */
  countdown?: boolean;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function clampInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function isCoverPreset(value: unknown): boolean {
  return typeof value === 'string' && COVER_PRESETS.some((p) => p.key === value);
}

export function coverPresetFor(key: string | null | undefined): CoverPreset {
  return COVER_PRESETS.find((p) => p.key === key) ?? COVER_PRESETS[0];
}

/**
 * Where a host's cover photo for this event may live, and nowhere else.
 *
 * Under `events/<eventId>/cover/`, so it belongs to this event: it is served,
 * mirrored and closed with the event's other media. The name is a random id the
 * browser picks, so a guest — who can write under `events/` — cannot guess it
 * to overwrite it.
 */
export function isCoverImageKey(key: unknown, eventId: string): key is string {
  if (typeof key !== 'string' || !eventId || eventId.includes('/')) return false;
  const prefix = `events/${eventId}/cover/`;
  if (!key.startsWith(prefix)) return false;
  return /^[A-Za-z0-9_-]{8,80}\.(jpg|jpeg|webp)$/.test(key.slice(prefix.length));
}

/**
 * Turn whatever the browser sent into the style to store, or a reason not to.
 *
 * '' or null clears the cover entirely. An unknown preset or a key for some
 * other event is refused rather than dropped: those are not preferences, they
 * are a request the UI cannot make.
 */
export function sanitizeCoverStyle(
  raw: string | null | undefined,
  eventId: string,
): { ok: true; value: string | null } | { ok: false; reason: string } {
  const text = (raw ?? '').trim();
  if (!text) return { ok: true, value: null };
  if (text.length > 4000) return { ok: false, reason: 'That cover could not be saved.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'That cover could not be saved.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'That cover could not be saved.' };
  }
  const input = parsed as Record<string, unknown>;
  const out: CoverStyle = {};

  if (input.image !== undefined && input.image !== null && input.image !== '') {
    if (!isCoverImageKey(input.image, eventId)) {
      return { ok: false, reason: 'That photo could not be used as the cover. Try uploading it again.' };
    }
    out.image = input.image;
  }
  if (input.preset !== undefined && input.preset !== null && input.preset !== '') {
    if (!isCoverPreset(input.preset)) {
      return { ok: false, reason: 'Choose one of the available backgrounds.' };
    }
    out.preset = input.preset as string;
  }
  const focus = clampInt(input.focus, 0, 100);
  if (focus !== null) out.focus = focus;
  const shade = clampInt(input.shade, MIN_SHADE, MAX_SHADE);
  if (shade !== null) out.shade = shade;
  const title = cleanText(input.title, MAX_COVER_TITLE);
  if (title) out.title = title;
  const subtitle = cleanText(input.subtitle, MAX_COVER_SUBTITLE);
  if (subtitle) out.subtitle = subtitle;
  if ((COVER_ALIGNMENTS as readonly unknown[]).includes(input.align)) {
    out.align = input.align as CoverAlign;
  }
  if ((COVER_HEIGHTS as readonly unknown[]).includes(input.height)) {
    out.height = input.height as CoverHeight;
  }
  if (typeof input.countdown === 'boolean') out.countdown = input.countdown;

  return { ok: true, value: Object.keys(out).length === 0 ? null : JSON.stringify(out) };
}

export interface ResolvedCover {
  /** The host's photo, or null for a preset background. */
  image: string | null;
  preset: CoverPreset;
  /** Which way the words go: a photo is always shaded dark. */
  tone: 'dark' | 'light';
  focus: number;
  shade: number;
  /** The custom headline, or null to use the event's name. */
  title: string | null;
  subtitle: string | null;
  align: CoverAlign;
  height: CoverHeight;
  countdown: boolean;
  /** True when the host has set anything at all. */
  customized: boolean;
}

/**
 * Everything a page needs to draw the cover, from whatever is on the row.
 *
 * Total: no style, a broken style and a style naming another event's photo all
 * resolve to the SharePix navy band the pages have always had.
 */
export function resolveEventCover(
  event: { id?: string | null; coverStyle?: string | null } | null | undefined,
): ResolvedCover {
  let style: CoverStyle = {};
  const cleaned = event?.id ? sanitizeCoverStyle(event.coverStyle, event.id) : null;
  if (cleaned?.ok && cleaned.value) style = JSON.parse(cleaned.value) as CoverStyle;
  const preset = coverPresetFor(style.preset);
  return {
    image: style.image ?? null,
    preset,
    tone: style.image ? 'dark' : preset.tone,
    focus: style.focus ?? 50,
    shade: style.shade ?? DEFAULT_SHADE,
    title: style.title ?? null,
    subtitle: style.subtitle ?? null,
    align: style.align ?? 'center',
    height: style.height ?? 'standard',
    countdown: style.countdown ?? true,
    customized: Object.keys(style).length > 0,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The countdown line, or null when there is nothing worth counting.
 *
 * Before the event: days to go. While guests can upload: how long they have
 * left, in days and hours, because "1d 19h" is what makes somebody open their
 * camera roll tonight rather than next week. After that, nothing — a cover
 * announcing that time has run out is a closed sign on a gallery that is
 * still worth visiting.
 */
export function coverCountdown(
  event: {
    date?: string | null;
    uploadWindowEndsAt?: string | null;
    uploadsClosed?: boolean | null;
  } | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!event) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (event.date && /^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    const day = Date.parse(`${event.date}T00:00:00Z`);
    if (Number.isFinite(day) && day > today) {
      const days = Math.round((day - today) / DAY_MS);
      return days === 1 ? 'Tomorrow' : `${days} days to go`;
    }
  }
  if (event.uploadsClosed) return null;
  const end = event.uploadWindowEndsAt ? Date.parse(event.uploadWindowEndsAt) : NaN;
  if (!Number.isFinite(end) || end <= now.getTime()) return null;
  const left = end - now.getTime();
  const days = Math.floor(left / DAY_MS);
  const hours = Math.floor((left % DAY_MS) / HOUR_MS);
  if (days === 0 && hours === 0) return 'Less than an hour left to share';
  if (days === 0) return `${hours}h left to share`;
  return `${days}d ${hours}h left to share`;
}
