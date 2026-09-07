/**
 * What a host thought of their event, and what SharePix may do with it.
 *
 * ## The line this module exists to draw
 *
 * The brief asks for a rating, and then a public review request sent only to
 * people who rated 4 or 5. Half of that is fine and half of it is not, and the
 * difference is not a matter of degree.
 *
 *   A TESTIMONIAL is advertising copy SharePix writes into its own pages. It
 *   is normal, legal and expected that a company asks its happy customers for
 *   it — nobody has ever believed a company's own website carries a
 *   representative sample of opinion, and nobody expects an unhappy customer to
 *   write an advert. Asking only satisfied hosts is fine.
 *
 *   A PUBLIC REVIEW is an entry in a record that belongs to everyone —
 *   Google, an app store, a directory. Soliciting those from satisfied
 *   customers only is review gating: the rating becomes a filter on who is
 *   invited to speak, and the public record it produces is skewed by design.
 *   It is against the policies of every platform that hosts such reviews, and
 *   the FTC's consumer-review rule treats manipulating the visible balance of
 *   reviews as deceptive.
 *
 * So this module supports the first and refuses to help with the second.
 * `branchFor` routes a positive rating to a testimonial ask and nothing else,
 * and there is deliberately no field, status or link anywhere here for a
 * third-party review. If SharePix later wants Google reviews, the ask has to go
 * to every host regardless of score, and that is a different function than any
 * of these.
 *
 * ## What a low rating gets
 *
 * Support, not silence. A host who rates 1-3 is asked what went wrong and given
 * a way to reach a person. Their answer is stored, counted and shown to admins
 * exactly like a good one. Nothing here suppresses, delays or discourages a
 * complaint, and `lowRatings` exists so that the number is impossible to lose.
 *
 * ## Permission
 *
 * A testimonial and the right to publish it are two separate acts. Someone can
 * write one and withhold the other, and the default is withheld: `consentFrom`
 * only produces a grant from an explicit true, so an unchecked box, a missing
 * field and a malformed request all mean no.
 */

/** The scale. Fixed, because a rating stored under one scale and read under
 * another is silently wrong rather than loudly broken. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** At or above this, a host is asked for a testimonial. Below it, for help. */
export const POSITIVE_RATING_MIN = 4;

/**
 * Which consent text was shown.
 *
 * Stored with every grant, because permission is only meaningful against the
 * words the person actually agreed to. Changing the wording below means
 * changing this string, and old grants keep pointing at what they were given.
 */
export const CONSENT_VERSION = 'testimonial-2026-09';

/** The words shown beside the checkbox. Never pre-ticked. */
export const CONSENT_TEXT =
  'You may use my comments on sharepix.net and in SharePix marketing.';

export type RatingBranch = 'testimonial' | 'support';

/** How a host's name may appear if their testimonial is ever published. */
export const DISPLAY_MODES = ['anonymous', 'first_name', 'first_initial', 'full_name'] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

/**
 * The safe default.
 *
 * Anonymous unless the host chooses otherwise. A name published because a
 * default said so is not a name anyone agreed to publish.
 */
export const DEFAULT_DISPLAY_MODE: DisplayMode = 'anonymous';

export function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value);
}

/** Where a testimonial sits on its way to being publishable, or not. */
export const TESTIMONIAL_STATUSES = [
  'NEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_CLARIFICATION',
  'PUBLISHED',
  'ARCHIVED',
] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

export function isTestimonialStatus(value: unknown): value is TestimonialStatus {
  return typeof value === 'string' && (TESTIMONIAL_STATUSES as readonly string[]).includes(value);
}

/**
 * A rating, or null.
 *
 * Null for anything that is not a whole number on the scale — including a
 * string that looks like one, a float, and a value from an old client that
 * thought the scale went to ten. Callers store null as "not rated" rather than
 * coercing, because a 0 or a 10 in this column is a number somebody will
 * eventually average.
 */
export function normalizeRating(value: unknown): number | null {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(n)) return null;
  if (n < RATING_MIN || n > RATING_MAX) return null;
  return n;
}

export function isPositive(rating: number | null | undefined): boolean {
  const value = normalizeRating(rating);
  return value !== null && value >= POSITIVE_RATING_MIN;
}

/**
 * What happens next after a score.
 *
 * 'testimonial' asks for words SharePix might publish, with permission.
 * 'support' asks what went wrong and offers a person. There is no third branch
 * and, in particular, no branch that asks anyone for a review on a platform
 * SharePix does not own.
 */
export function branchFor(rating: number | null | undefined): RatingBranch | null {
  const value = normalizeRating(rating);
  if (value === null) return null;
  return value >= POSITIVE_RATING_MIN ? 'testimonial' : 'support';
}

/** Longest testimonial accepted. Long enough for a paragraph, short enough
 * that a paste of a novel is refused before it reaches storage. */
export const TESTIMONIAL_MAX_LENGTH = 1200;
/** Longest private note accepted. This one is a complaint; give it room. */
export const FEEDBACK_MAX_LENGTH = 4000;

/**
 * Trim free text to something storable, or ''.
 *
 * Control characters are stripped by scanning code points rather than by a
 * regular expression: a character class written with literal control bytes has
 * embedded those bytes into a source file in this codebase three times now.
 */
export function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // Keep tab and newline; drop the rest of C0, DEL and C1.
    if (code === 9 || code === 10) {
      out += char;
      continue;
    }
    if (code < 32 || (code >= 127 && code <= 159)) continue;
    out += char;
  }
  return out.trim().slice(0, maxLength);
}

export interface ConsentGrant {
  granted: boolean;
  consentVersion: string;
  consentText: string;
}

/**
 * Turn whatever the client sent into a permission record.
 *
 * Only a literal `true` grants anything. A string 'true', a 1, a missing field
 * and an object all produce a refusal, because the cost of reading a stray
 * truthy value as consent is publishing someone's words without it.
 */
export function consentFrom(value: unknown): ConsentGrant {
  return {
    granted: value === true,
    consentVersion: CONSENT_VERSION,
    consentText: CONSENT_TEXT,
  };
}

export interface FeedbackFacts {
  rating?: number | null;
  testimonialText?: string | null;
  marketingPermission?: boolean | null;
  status?: string | null;
}

/**
 * Whether a testimonial may appear anywhere a customer can see.
 *
 * Every condition is required, and the function is the only place that
 * decision is made so that no page can assemble its own version of it. In
 * particular a status of APPROVED is not enough on its own: permission can be
 * withdrawn after approval, and the permission flag is what is checked at the
 * moment of publishing rather than what was true when an admin clicked.
 */
export function mayPublish(facts: FeedbackFacts | null | undefined): boolean {
  if (!facts) return false;
  if (facts.marketingPermission !== true) return false;
  if (!cleanText(facts.testimonialText, TESTIMONIAL_MAX_LENGTH)) return false;
  return facts.status === 'APPROVED' || facts.status === 'PUBLISHED';
}

/** How a host is credited, given their choice and their name. */
export function displayNameFor(
  mode: DisplayMode | null | undefined,
  name: string | null | undefined,
): string {
  const clean = cleanText(name, 80);
  if (!clean || mode === 'anonymous' || !mode) return '';
  const [first = '', ...rest] = clean.split(/\s+/);
  if (mode === 'first_name') return first;
  if (mode === 'first_initial') {
    const last = rest[rest.length - 1] ?? '';
    return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
  }
  return clean;
}

export interface RatingSummary {
  /** How many hosts answered at all. */
  responses: number;
  /** Mean to one decimal, or null when nobody has answered. */
  average: number | null;
  /** Counts by score, 1..5. */
  distribution: Record<number, number>;
  /** 4s and 5s as a percentage of responses, or null with no responses. */
  positiveRate: number | null;
  /** 1s, 2s and 3s. Kept as its own number so it cannot quietly go unread. */
  lowRatings: number;
  /** Testimonials written, and of those, how many may be published. */
  testimonials: number;
  publishable: number;
}

/**
 * Roll up whatever ratings exist.
 *
 * Returns null averages rather than zeros for an empty set: "average rating
 * 0.0" reads as a catastrophe where the truth is that nobody has answered yet.
 * The same choice the monthly report makes about success rate.
 */
export function summarize(rows: readonly FeedbackFacts[]): RatingSummary {
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let responses = 0;
  let positive = 0;
  let testimonials = 0;
  let publishable = 0;

  for (const row of rows) {
    const rating = normalizeRating(row.rating);
    if (rating !== null) {
      distribution[rating] += 1;
      total += rating;
      responses += 1;
      if (rating >= POSITIVE_RATING_MIN) positive += 1;
    }
    if (cleanText(row.testimonialText, TESTIMONIAL_MAX_LENGTH)) {
      testimonials += 1;
      if (mayPublish(row)) publishable += 1;
    }
  }

  return {
    responses,
    average: responses === 0 ? null : Math.round((total / responses) * 10) / 10,
    distribution,
    positiveRate: responses === 0 ? null : Math.round((positive / responses) * 1000) / 10,
    lowRatings: distribution[1] + distribution[2] + distribution[3],
    testimonials,
    publishable,
  };
}
