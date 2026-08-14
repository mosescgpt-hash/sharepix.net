/**
 * Content-moderation policy for uploaded photos, kept as pure logic so the
 * category choices — the part that actually decides whether this feature is
 * useful or maddening — can be unit tested without calling AWS.
 *
 * Tuned for wedding receptions specifically. Rekognition reports plenty of
 * things that are completely normal at a wedding (champagne, cigars, a kiss,
 * a strapless dress, someone in a pool). Flagging those would mean the host
 * gets pestered all night and stops trusting the alerts, so the allow list
 * below deliberately wins over the block list.
 */

export interface ModerationLabel {
  Name?: string;
  ParentName?: string;
  Confidence?: number;
}

/**
 * Only flag when Rekognition is quite sure. Lower values catch more but drag in
 * dresses, shirtless groomsmen, and beach shots.
 */
export const MODERATION_CONFIDENCE_THRESHOLD = 90;

/**
 * Never flag these, whatever else Rekognition says about the photo. Checked
 * before the block list, so a label that matches both is allowed.
 *
 * Alcohol and tobacco are here by explicit product decision: a reception is wall
 * to wall with champagne toasts and cigars.
 */
const ALWAYS_ALLOWED = [
  'alcohol',
  'alcohol use',
  'drinking',
  'drugs & tobacco',
  'drugs and tobacco',
  'tobacco',
  'smoking',
  'tobacco products',
  // Normal wedding photography that older taxonomies lump in with adult content.
  'suggestive',
  'female swimwear or underwear',
  'male swimwear or underwear',
  'swimwear or underwear',
  'revealing clothes',
  'partially exposed buttocks',
  'kissing',
  'non-explicit nudity',
  'non-explicit nudity of intimate parts and kissing',
  'implied nudity',
  'obstructed intimate parts',
  'gambling',
  'rude gestures',
  'middle finger',
];

/**
 * Categories worth interrupting a wedding for. Deliberately narrow: explicit
 * sexual content and nudity, per the agreed policy. Matched against both the
 * label and its parent, so a child label under one of these parents flags too.
 */
const BLOCKED = [
  'explicit',
  'explicit nudity',
  'explicit sexual activity',
  'sexual activity',
  'graphic nudity',
  'nudity',
  'exposed male genitalia',
  'exposed female genitalia',
  'exposed buttocks',
  'exposed female nipple',
  'sex toys',
];

function normalize(value?: string): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Decide whether a photo should be held back for review.
 *
 * Returns the human-readable reasons alongside the verdict so the host is told
 * what was detected rather than just "blocked".
 */
export function evaluateModeration(
  labels: ModerationLabel[] | undefined,
  threshold: number = MODERATION_CONFIDENCE_THRESHOLD,
): { flagged: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const label of labels ?? []) {
    const confidence = label.Confidence ?? 0;
    if (confidence < threshold) continue;

    const name = normalize(label.Name);
    const parent = normalize(label.ParentName);

    // An explicit allow on either the label or its parent wins outright.
    if (ALWAYS_ALLOWED.includes(name) || ALWAYS_ALLOWED.includes(parent)) continue;

    if (BLOCKED.includes(name) || BLOCKED.includes(parent)) {
      reasons.push(label.Name ?? parent);
    }
  }

  return { flagged: reasons.length > 0, reasons: [...new Set(reasons)] };
}
