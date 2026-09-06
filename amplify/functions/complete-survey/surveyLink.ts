/**
 * The completion function's copy of the survey link encoding.
 *
 * Byte-identical to lib/surveyLink.ts below the header. This is the copy that
 * actually reads a link handed back by a visitor.
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
