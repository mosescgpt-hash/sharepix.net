/**
 * The link in a survey invitation.
 *
 * One opaque string in the URL that carries both which obligation it refers to
 * and the secret proving the holder was sent it. Encoded rather than passed as
 * separate parameters so a person looking at the link cannot see, or edit, the
 * event id inside it — and so there is exactly one thing to copy, paste and get
 * wrong.
 *
 * ## Why encode rather than index
 *
 * The obligation's row id is `<eventId>#<surveyId>`, which is what makes one
 * obligation per piece of research. Looking a row up by a random token instead
 * would need a secondary index, and no function in this codebase queries one
 * yet — the generated index name cannot be confirmed without a deploy. Carrying
 * the id inside the link means the lookup is a single get by primary key, which
 * is the cheapest and least surprising thing available.
 *
 * The id is therefore not a secret, and is not treated as one. The token beside
 * it is: it is compared server-side, in constant time, before anything changes.
 */

/** Separator that cannot appear in an event id, a survey id, or hex. */
const SEP = '|';

export interface SurveyLinkParts {
  eventId: string;
  surveyId: string;
  token: string;
}

/** URL-safe base64 without padding, which survives an email client untouched. */
function toBase64Url(value: string): string {
  const base64 =
    typeof btoa === 'function'
      ? btoa(value)
      : // eslint-disable-next-line no-undef
        Buffer.from(value, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return typeof atob === 'function'
      ? atob(padded)
      : // eslint-disable-next-line no-undef
        Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

export function encodeSurveyLink(parts: SurveyLinkParts): string {
  return toBase64Url([parts.eventId, parts.surveyId, parts.token].join(SEP));
}

/**
 * Read a link back, or null.
 *
 * Null for anything malformed, and the caller must treat that exactly as it
 * treats a wrong token: refused, with the same message. Distinguishing "this
 * link is gibberish" from "this link is not yours" tells a stranger which
 * event ids are real.
 */
export function decodeSurveyLink(encoded: string | null | undefined): SurveyLinkParts | null {
  if (!encoded) return null;
  const decoded = fromBase64Url(encoded.trim());
  if (!decoded) return null;
  const parts = decoded.split(SEP);
  if (parts.length !== 3) return null;
  const [eventId, surveyId, token] = parts;
  if (!eventId || !surveyId || !token) return null;
  // Bounded, because these become a DynamoDB key and a comparison.
  if (eventId.length > 128 || surveyId.length > 64 || token.length > 128) return null;
  return { eventId, surveyId, token };
}
