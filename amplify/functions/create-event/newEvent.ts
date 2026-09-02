/**
 * What a new event is, and whether it starts active.
 *
 * Pure functions, no SDK and no I/O, so every rule below is unit tested
 * directly and still bundles into the Lambda — the same split as
 * stripe-checkout/pricing.ts and media-url/access.ts.
 *
 * This exists because event creation used to be a direct client-side model
 * write. The browser chose the tier, the photo and video limits, the expiry
 * dates, and `paid` — which defaulted to **true**. A crafted request could
 * therefore mint an unlimited, fully-active Premium event for nothing, and the
 * only thing standing in its way was the UI. Everything the client used to
 * decide is decided here instead; the request now supplies a name, a date, a
 * place and a plan, and nothing else it could profit from lying about.
 *
 * The plan table below is duplicated from lib/pricing.ts on purpose: Amplify
 * functions take no cross-bundle imports. The two MUST move together — see the
 * comment on TIER_PLANS.
 */

/**
 * Plans, mirrored from lib/pricing.ts. These are the authoritative values now:
 * lib/pricing.ts drives what a host is *shown*, this drives what they *get*.
 *
 * Keep the two in step. A limit that is generous here and stingy there sells
 * something we don't deliver; the reverse gives it away. The unit tests assert
 * the shape, not the numbers — the numbers are a business decision, so changing
 * one is a deliberate two-file edit.
 */
export interface TierPlan {
  /** Retail price in cents, used only to decide whether a code comps it. */
  priceCents: number;
  /** null = unlimited. */
  photoLimit: number | null;
  /** null = unlimited. Videos are capped separately; see lib/pricing.ts. */
  videoLimit: number | null;
  /** How long the gallery stays reachable, from creation. */
  accessDays: number;
}

export const TIER_PLANS: Record<string, TierPlan> = {
  starter: { priceCents: 1900, photoLimit: 100, videoLimit: 2, accessDays: 14 },
  standard: { priceCents: 3900, photoLimit: 1000, videoLimit: 10, accessDays: 90 },
  premium: { priceCents: 7900, photoLimit: null, videoLimit: 30, accessDays: 365 },
};

/**
 * Corporate events are included in a subscription rather than sold per event,
 * so they are handled explicitly rather than sitting in TIER_PLANS — a price of
 * zero there would make "comped by a discount code" and "covered by a
 * subscription" indistinguishable, and only one of those needs a live
 * subscription behind it.
 *
 * accessDays is the upload window plus the corporate retention period, matching
 * computeAccessExpiresAt in lib/pricing.ts.
 */
export const CORPORATE_EVENT_PLAN: TierPlan = {
  priceCents: 0,
  photoLimit: null,
  videoLimit: 30,
  accessDays: 30 + 365,
};

/** The upload window every plan gets, in days. Mirrors UPLOAD_WINDOW_DAYS. */
export const UPLOAD_WINDOW_DAYS = 30;

/** Stripe won't charge below this, so a remainder under it is comped instead. */
export const STRIPE_MIN_CHARGE_CENTS = 50;

/** Statuses that count as a live Corporate subscription. Mirrors isCorporateActive. */
const ACTIVE_CORPORATE_STATUSES = ['active', 'trialing', 'past_due'];

export function isCorporateStatusActive(status: string | null | undefined): boolean {
  return ACTIVE_CORPORATE_STATUSES.includes((status ?? '').trim().toLowerCase());
}

/** The plan for a tier id, or null when it isn't one we sell. */
export function planFor(tier: string): TierPlan | null {
  const id = normalizeTier(tier);
  if (id === 'corporate') return CORPORATE_EVENT_PLAN;
  return TIER_PLANS[id] ?? null;
}

export function normalizeTier(tier: string | null | undefined): string {
  return (tier ?? '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Input cleaning. Everything below is shown to guests, put in filenames, or
// written to the row, so it is bounded and stripped of control characters
// rather than trusted.
// ---------------------------------------------------------------------------

// CR/LF among them: they have no place in any of these fields, and are what
// enable injection when a value later lands in an email header or a filename.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Longest event name we store, matching the form's maxLength. */
export const MAX_EVENT_NAME = 80;

export function sanitizeEventName(value: string | null | undefined): string {
  return (value ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_EVENT_NAME)
    .trim();
}

/** How much of each location part we keep. Mirrors lib/eventLocation.ts. */
const MAX_CITY = 60;
const MAX_STATE = 40;

/**
 * Clean one part of a location. Letters, digits, spaces and the punctuation
 * real place names use (St. Paul, Coeur d'Alene, Winston-Salem) survive;
 * everything else goes, so this can be shown and put in a filename safely.
 */
function cleanLocationPart(value: string, maxLength: number): string {
  return value
    .replace(/[^\p{L}\p{N} .'\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** "Minneapolis, MN", or '' when neither part survives. Mirrors formatEventLocation. */
export function formatEventLocation(
  city: string | null | undefined,
  state: string | null | undefined,
): string {
  const parts = [
    cleanLocationPart(city ?? '', MAX_CITY),
    cleanLocationPart(state ?? '', MAX_STATE),
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * A calendar date, or null. The field is an AWSDate, so anything that isn't
 * exactly YYYY-MM-DD would be rejected by AppSync on the way back out — better
 * to drop a malformed one here than to write a row that can't be read.
 */
export function sanitizeEventDate(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  // Reject the dates that parse but roll over (2025-02-30 → March 2nd).
  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/** The host's display name, bounded. Mirrors sanitizeDisplayName. */
export function sanitizeHostName(value: string | null | undefined): string {
  return (value ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * The name shown as the host on the event: their saved profile name, else the
 * part of their email before the @, else a neutral fallback. Derived from the
 * caller's own identity rather than taken from the request, so it can't be used
 * to attribute an event to someone else.
 */
export function hostNameFrom(profileName: string, email: string): string {
  const chosen = sanitizeHostName(profileName);
  if (chosen) return chosen;
  const local = sanitizeHostName((email ?? '').split('@')[0]);
  return local || 'Host';
}

/**
 * The Amplify owner string for a caller, "<sub>::<username>".
 *
 * This is the field every owner-scoped rule in the schema reads, and the format
 * Amplify itself writes. Building it from the identity — never from the request
 * — is what keeps a host from creating an event owned by someone else.
 */
export function ownerStringFor(sub: string, username: string): string {
  const id = (sub ?? '').trim();
  if (!id) return '';
  const name = (username ?? '').trim();
  return name ? `${id}::${name}` : id;
}

// ---------------------------------------------------------------------------
// Discount codes.
// ---------------------------------------------------------------------------

export interface DiscountRow {
  code: string;
  active: boolean;
  expiresAt: string;
  usedCount: number;
  maxUses: number;
  unlimitedUses: boolean;
  /** Comma-separated scopes on newer codes, e.g. "event:premium,extend". */
  appliesToScopes: string;
  /** Legacy per-tier scope on older codes. */
  appliesToTier: string;
  discountType: string;
  percentOff: number | null;
  amountOffCents: number | null;
}

/**
 * Whether a code covers a given paid item. Mirrors the `covers` rule in
 * stripe-checkout/handler.ts — the two have to agree, or a code would comp an
 * event here that checkout would refuse to discount (or the reverse).
 */
export function codeCovers(row: DiscountRow, scope: string): boolean {
  const scopesRaw = (row.appliesToScopes ?? '').toLowerCase().trim();
  if (scopesRaw) {
    const entries = scopesRaw.split(',').map((entry) => entry.trim());
    return (
      scopesRaw === 'all' ||
      entries.includes(scope) ||
      // A pre-split 'event' scope covers every event plan.
      (scope.startsWith('event:') && entries.includes('event'))
    );
  }
  // Legacy codes carry only appliesToTier: 'all'/blank was universal, a specific
  // tier only ever applied to creating an event on that plan.
  const legacyTier = (row.appliesToTier ?? '').toLowerCase();
  return legacyTier === '' || legacyTier === 'all' ? true : scope === `event:${legacyTier}`;
}

export type CodeCheck = { ok: true } | { ok: false; reason: string };

/**
 * Why a code can't be used, or ok. Each message names the actual problem: these
 * are the host's own codes to type, so telling them "expired" rather than
 * "invalid" saves a support email, and none of it reveals anything they
 * couldn't learn by trying another code.
 */
export function codeUsable(row: DiscountRow | null, scope: string, nowMs: number): CodeCheck {
  if (!row) return { ok: false, reason: 'That discount code is not valid.' };
  if (row.active !== true) return { ok: false, reason: 'That discount code is no longer active.' };

  const expires = new Date(row.expiresAt ?? '').getTime();
  if (Number.isFinite(expires) && expires <= nowMs) {
    return { ok: false, reason: 'That discount code has expired.' };
  }

  // An unlimited code has no ceiling — usedCount still counts up so redemptions
  // can be measured. Anything else must have uses remaining.
  if (row.unlimitedUses !== true && row.usedCount >= row.maxUses) {
    return { ok: false, reason: 'That discount code has no uses left.' };
  }

  if (!codeCovers(row, scope)) {
    return { ok: false, reason: 'That discount code does not apply to this plan.' };
  }

  const percentOff = row.percentOff == null ? 100 : row.percentOff;
  const amountOffCents = row.amountOffCents ?? 0;
  if (row.discountType === 'amount') {
    if (!(amountOffCents >= 1)) return { ok: false, reason: 'That discount code is misconfigured.' };
  } else if (!(percentOff >= 1 && percentOff <= 100)) {
    return { ok: false, reason: 'That discount code is misconfigured.' };
  }

  return { ok: true };
}

/**
 * What's still owed after a code, in cents. Mirrors applyDiscount in
 * lib/pricing.ts and effectiveAmountOffCents in stripe-checkout/discount-math.ts:
 * a remainder Stripe is too small to charge is treated as nothing owed, because
 * the alternative is a checkout that fails at the card step.
 */
export function remainingCents(priceCents: number, row: DiscountRow): number {
  if (!(priceCents > 0)) return 0;
  if (row.discountType === 'amount') {
    const off = Math.max(0, Math.round(row.amountOffCents ?? 0));
    const remainder = Math.max(0, priceCents - off);
    return remainder < STRIPE_MIN_CHARGE_CENTS ? 0 : remainder;
  }
  const percent = Math.min(100, Math.max(0, row.percentOff == null ? 100 : row.percentOff));
  const remainder = Math.round((priceCents * (100 - percent)) / 100);
  return remainder < STRIPE_MIN_CHARGE_CENTS ? 0 : remainder;
}

// ---------------------------------------------------------------------------
// The activation decision — the one this whole file exists for.
// ---------------------------------------------------------------------------

export type Activation =
  /** Live immediately. `paid` is written true and uploads work at once. */
  | { kind: 'active'; via: 'corporate' | 'comped' }
  /** Created but inactive until the Stripe webhook flips `paid`. */
  | { kind: 'pending'; owedCents: number }
  | { kind: 'refused'; reason: string };

/**
 * Whether a new event starts active, and if not, what it owes.
 *
 * The old client-side write set `paid: true` by default, so this is the rule
 * that used to be missing entirely. There are exactly two ways to open an
 * active event without paying, and both are checked against server state:
 *
 *  - a live Corporate subscription, read from the subscription table; and
 *  - a discount code that covers the whole price, read from the code table.
 *
 * Everything else is created pending and stays unusable — createEventPhoto
 * refuses uploads to an event with `paid: false` — until Stripe confirms.
 */
export function activationFor({
  tier,
  corporateActive,
  discount,
}: {
  tier: string;
  corporateActive: boolean;
  /** A validated code and the plan's price, or null when none was supplied. */
  discount: { row: DiscountRow; priceCents: number } | null;
}): Activation {
  const id = normalizeTier(tier);
  const plan = planFor(id);
  if (!plan) return { kind: 'refused', reason: 'Choose one of the available plans.' };

  if (id === 'corporate') {
    return corporateActive
      ? { kind: 'active', via: 'corporate' }
      : {
          kind: 'refused',
          reason: 'An active Corporate subscription is required for corporate events.',
        };
  }

  if (discount) {
    const owed = remainingCents(discount.priceCents, discount.row);
    if (owed <= 0) return { kind: 'active', via: 'comped' };
    return { kind: 'pending', owedCents: owed };
  }

  return { kind: 'pending', owedCents: plan.priceCents };
}

// ---------------------------------------------------------------------------
// Row shape.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NewEventRow {
  name: string;
  date: string | null;
  location: string | null;
  tier: string;
  photoLimit: number | null;
  videoLimit: number | null;
  accessExpiresAt: string;
  uploadWindowEndsAt: string;
  paid: boolean;
  createdBy: string;
}

/**
 * The row a new event starts as. Every field is derived here — from the plan,
 * from the clock, and from the activation decision — so none of it can be
 * dictated by the request.
 */
export function newEventRow({
  name,
  date,
  city,
  state,
  tier,
  hostName,
  active,
  now = new Date(),
}: {
  name: string;
  date?: string | null;
  city?: string | null;
  state?: string | null;
  tier: string;
  hostName: string;
  active: boolean;
  now?: Date;
}): NewEventRow {
  const id = normalizeTier(tier);
  const plan = planFor(id);
  if (!plan) throw new Error('Choose one of the available plans.');

  const clean = sanitizeEventName(name);
  if (!clean) throw new Error('Give your event a name.');

  const location = formatEventLocation(city, state);
  return {
    name: clean,
    date: sanitizeEventDate(date),
    location: location || null,
    tier: id,
    photoLimit: plan.photoLimit,
    videoLimit: plan.videoLimit,
    accessExpiresAt: new Date(now.getTime() + plan.accessDays * DAY_MS).toISOString(),
    uploadWindowEndsAt: new Date(now.getTime() + UPLOAD_WINDOW_DAYS * DAY_MS).toISOString(),
    paid: active,
    createdBy: sanitizeHostName(hostName) || 'Host',
  };
}

/**
 * The alphabet event codes are drawn from: no 0/O and no 1/I/L, because these
 * get read aloud and typed off a table tent.
 */
export const EVENT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const EVENT_CODE_LENGTH = 6;

/**
 * A short human-friendly event code, e.g. "K7MPQ2".
 *
 * Takes its randomness as an argument so the handler can pass the CSPRNG and
 * the tests can pass something predictable. The browser version used Math.random,
 * which was fine when the code was only a convenience; now that it is generated
 * server-side it costs nothing to make it unguessable.
 */
export function eventCodeFrom(randomIndex: (max: number) => number): string {
  let code = '';
  for (let i = 0; i < EVENT_CODE_LENGTH; i += 1) {
    code += EVENT_CODE_ALPHABET[randomIndex(EVENT_CODE_ALPHABET.length)];
  }
  return code;
}
