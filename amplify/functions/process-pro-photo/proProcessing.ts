/**
 * Turning a photographer's upload into something a guest can see — and
 * deciding what happens to the file they sent.
 *
 * ## SharePix does not keep originals
 *
 * The default is that the original is deleted as soon as a preview and a
 * thumbnail exist. SharePix needs it for about three seconds and never again:
 * what the gallery serves is the preview, and the photographer already has
 * their own files — they took them.
 *
 * Keeping them would mean holding thousands of photographers' full-resolution
 * work, which is a storage bill that grows forever and, more to the point, a
 * custodial responsibility nobody asked for. A breach of a bucket full of
 * other people's wedding originals is a different kind of incident from a
 * breach of reduced previews.
 *
 * A photographer who wants SharePix to hold them can say so — `keepOriginal`
 * — and that is an informed opt-in, not a default and not the host's call.
 *
 * ## The rule that matters more than any of that
 *
 * **Never delete an original until the derivatives are confirmed written.**
 *
 * A photographer at a wedding may have already formatted the card. If
 * processing fails and the original was deleted on the way, the photograph is
 * gone — not degraded, gone — and SharePix destroyed it. So discarding is
 * conditional on success, and every failure path keeps the file so it can be
 * retried. `discardDecision` exists so that rule is one tested function rather
 * than an `if` somewhere in a handler's catch block.
 *
 * ## Formats
 *
 * JPEG and PNG in. WebP is rejected: the decoder does not support it, and
 * saying so is better than a half-written preview. No camera emits WebP — it
 * is a delivery format — so this costs nothing real, and RAW is future work
 * for the desktop uploader, which will send a JPEG preview instead.
 */

/** Input types the processor can actually decode. Checked against real bytes. */
export const ACCEPTED_INPUT_MIMES = ['image/jpeg', 'image/png'] as const;

export type AcceptedInputMime = (typeof ACCEPTED_INPUT_MIMES)[number];

/**
 * What a rejected input is told.
 *
 * Names the formats that work rather than only the one that did not, because
 * the person reading it is mid-upload and wants to know what to do next.
 */
export const UNSUPPORTED_FORMAT_MESSAGE =
  'That file could not be read. Professional uploads accept JPEG and PNG.';

export function isAcceptedInput(mime: string | null | undefined): mime is AcceptedInputMime {
  return (ACCEPTED_INPUT_MIMES as readonly string[]).includes((mime ?? '').toLowerCase());
}

/**
 * The largest original the processor will take.
 *
 * Jimp decodes to raw RGBA, so memory is roughly width × height × 4 regardless
 * of how well the file compressed. A 100 MP panorama would be 400 MB of bitmap
 * before any copies, which is how a processor runs out of memory on one photo
 * and stops working for everybody else on the event.
 */
export const MAX_INPUT_BYTES = 80 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 60_000_000;

/** Output. JPEG because it is universal, and quality tuned for a gallery. */
export const PREVIEW_MIME = 'image/jpeg';
export const PREVIEW_QUALITY = 82;
export const THUMBNAIL_QUALITY = 70;

export interface ScaleResult {
  width: number;
  height: number;
  /** False when the source was already at or under the target. */
  resized: boolean;
}

/**
 * Fit an image inside a long-edge target, preserving aspect ratio.
 *
 * Never enlarges. A photographer who sends a 900px file gets a 900px preview,
 * not a soft 1800px upscale of it — inventing pixels makes their work look
 * worse, which is the one outcome this whole feature is trying to avoid.
 */
export function scaleToLongEdge(
  width: number,
  height: number,
  longEdge: number,
): ScaleResult {
  if (!(width > 0) || !(height > 0) || !(longEdge > 0)) {
    return { width: 0, height: 0, resized: false };
  }
  const current = Math.max(width, height);
  if (current <= longEdge) return { width, height, resized: false };
  const ratio = longEdge / current;
  return {
    // Round, then floor at 1: a very wide panorama's short edge can round to
    // zero, and a zero-height image is a crash rather than a small picture.
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    resized: true,
  };
}

export interface SourceFacts {
  bytes: number;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
}

export type RejectReason = 'format' | 'too-large' | 'too-many-pixels' | 'unreadable';

export interface AcceptDecision {
  ok: boolean;
  reason: RejectReason | null;
  message: string;
}

/** Whether this upload can be processed at all. */
export function canProcess(source: SourceFacts): AcceptDecision {
  const no = (reason: RejectReason, message: string): AcceptDecision => ({
    ok: false,
    reason,
    message,
  });

  if (!isAcceptedInput(source.mime)) {
    return no('format', UNSUPPORTED_FORMAT_MESSAGE);
  }
  if (!(source.bytes > 0)) {
    return no('unreadable', 'That file appeared to be empty.');
  }
  if (source.bytes > MAX_INPUT_BYTES) {
    return no(
      'too-large',
      `That file is larger than ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB.`,
    );
  }
  // Dimensions are optional: they are only known once the header is read, and
  // the size check above runs before anything is decoded.
  const width = source.width ?? 0;
  const height = source.height ?? 0;
  if (width > 0 && height > 0 && width * height > MAX_INPUT_PIXELS) {
    return no('too-many-pixels', 'That image has more pixels than we can process.');
  }
  return { ok: true, reason: null, message: '' };
}

export interface DerivativeState {
  /** True once the preview object is confirmed written to storage. */
  previewWritten: boolean;
  /** True once the thumbnail object is confirmed written. */
  thumbnailWritten: boolean;
}

export interface DiscardDecision {
  discard: boolean;
  /** Why. Logged, and what the tests assert on. */
  reason:
    | 'photographer-opted-in'
    | 'derivatives-incomplete'
    | 'processing-failed'
    | 'replaced-by-derivatives';
}

/**
 * Whether the original may now be deleted.
 *
 * Three ways to answer no and one to answer yes, and the three matter more:
 *
 * - The photographer asked us to keep it. Their file, their call.
 * - Processing failed. The original is the only copy SharePix can retry from.
 * - A derivative is missing. Half-processed is not processed, and a preview
 *   without a thumbnail is a photo that will need doing again.
 *
 * A photographer may have formatted the card already. Deleting on any of those
 * paths does not degrade the photograph, it destroys it.
 */
export function discardDecision(
  state: DerivativeState & { keepOriginal?: boolean | null; failed?: boolean | null },
): DiscardDecision {
  if (state.failed) return { discard: false, reason: 'processing-failed' };
  if (!state.previewWritten || !state.thumbnailWritten) {
    return { discard: false, reason: 'derivatives-incomplete' };
  }
  if (state.keepOriginal === true) {
    return { discard: false, reason: 'photographer-opted-in' };
  }
  return { discard: true, reason: 'replaced-by-derivatives' };
}

/**
 * What a photographer is told about their originals, before they choose.
 *
 * Written to be read by somebody deciding, so it says what happens by default
 * and what changes if they tick it — rather than describing only the option.
 */
export const KEEP_ORIGINALS_EXPLANATION =
  'By default we delete your original file once we have made the preview, and keep only the preview. Tick this if you would rather we hold your originals for the life of the event.';

/**
 * Turning the setting on affects new uploads only.
 *
 * Turning it OFF must not sweep up originals already held: a photographer
 * changing a preference has not asked us to delete files, and reading it that
 * way would destroy work on a checkbox click. Removing what is already stored
 * is a separate, deliberate action with its own confirmation.
 */
export const KEEP_ORIGINALS_CHANGE_NOTE =
  'This applies to photos you upload from now on. Originals we already hold stay until you delete them.';

export interface WatermarkFacts {
  watermarkEnabled?: boolean | null;
  watermarkText?: string | null;
  businessName?: string | null;
}

/**
 * The watermark to burn into a preview, or null for none.
 *
 * Off unless switched on, and applied only to generated derivatives — never to
 * a stored original, which is the photographer's file and is returned to them
 * exactly as sent.
 *
 * Falls back to the business name when the switch is on but no text was given,
 * because an enabled watermark that renders nothing looks like a bug to the
 * person who enabled it.
 */
export function watermarkFor(profile: WatermarkFacts): string | null {
  if (profile.watermarkEnabled !== true) return null;
  const text = (profile.watermarkText ?? '').trim() || (profile.businessName ?? '').trim();
  if (!text) return null;
  return text.slice(0, 60);
}
