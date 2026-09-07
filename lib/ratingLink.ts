/**
 * The link in a rating request.
 *
 * Same idea as lib/surveyLink.ts and, deliberately, a separate file: that one
 * carries three parts because a research obligation is keyed by event AND
 * survey, and this one carries two because feedback is keyed by event alone.
 * Merging them would mean a shared module copied into two more Lambdas — the
 * function copies in this codebase cannot import from lib/ — to save a dozen
 * lines of base64 that have never changed.
 *
 * The event id inside is not a secret and is not treated as one. It is here so
 * the lookup is a single get by primary key rather than a query against a
 * secondary index whose generated name cannot be confirmed without a deploy.
 * The token beside it is the credential, and is compared server-side before
 * anything is written.
 */

/** Separator that cannot appear in an event id or in hex. */
const SEP = '|';

export interface RatingLinkParts {
  eventId: string;
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

export function encodeRatingLink(parts: RatingLinkParts): string {
  return toBase64Url([parts.eventId, parts.token].join(SEP));
}

/**
 * Read a link back, or null.
 *
 * Null for anything malformed, and the caller must treat that exactly as it
 * treats a wrong token: refused, with the same message. Distinguishing "this
 * link is gibberish" from "this link is not yours" tells a stranger which event
 * ids are real.
 */
export function decodeRatingLink(encoded: string | null | undefined): RatingLinkParts | null {
  if (!encoded) return null;
  const decoded = fromBase64Url(encoded.trim());
  if (!decoded) return null;
  const parts = decoded.split(SEP);
  if (parts.length !== 2) return null;
  const [eventId, token] = parts;
  if (!eventId || !token) return null;
  // Bounded, because these become a DynamoDB key and a comparison.
  if (eventId.length > 128 || token.length > 128) return null;
  return { eventId, token };
}
