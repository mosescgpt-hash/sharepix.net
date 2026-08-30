/** Allowed image MIME types for guest uploads. */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
];

export const ALLOWED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.heic',
  '.heif',
];

export const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/3gpp',
];

export const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v', '.3gp'];

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Video ceiling. Phones record 4K/60 at roughly 400 MB per minute, so the old
 * 100 MB cap rejected clips as short as **20 seconds** — the length of a toast
 * or a first dance. 250 MB clears roughly 35 seconds at 4K/60, over a minute at
 * 4K/30, and four minutes at 1080p — the whole range of "a guest filmed a
 * moment" without reaching for "a guest filmed the ceremony".
 *
 * Storing a bigger ceiling costs nothing; *watching* is what is billed, and it
 * scales with the file size on every play. Halving the ceiling halves the cost
 * of every view of the biggest clips an event can hold. See docs/media-limits.md.
 */
export const MAX_VIDEO_SIZE_BYTES = 250 * 1024 * 1024;

/** The video ceiling as it is written in guest-facing copy. */
export const MAX_VIDEO_SIZE_LABEL = `${Math.round(MAX_VIDEO_SIZE_BYTES / (1024 * 1024))} MB`;

export function isAllowedImageType(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.includes(mimeType.toLowerCase());
}

export function isAllowedFileSize(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_FILE_SIZE_BYTES;
}

export function isAllowedVideoType(mimeType: string): boolean {
  return ALLOWED_VIDEO_TYPES.includes(mimeType.toLowerCase());
}

export function isVideoFilename(name: string): boolean {
  const lowerName = name.toLowerCase();
  return ALLOWED_VIDEO_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

/** Human-readable reason a file was rejected, or null if it is fine. */
export function validateImageFile(file: { type: string; size: number; name: string }): string | null {
  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_IMAGE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  const browserOmittedType = file.type.trim() === '';
  if (!isAllowedImageType(file.type) && !(browserOmittedType && hasAllowedExtension)) {
    return `"${file.name}" is not a supported image type. Use JPG, PNG, GIF, WEBP, AVIF, or HEIC.`;
  }
  if (!isAllowedFileSize(file.size)) {
    return `"${file.name}" is larger than 25 MB. Resize it and try again.`;
  }
  return null;
}

/**
 * Human-readable reason an event photo or short video was rejected, or null if
 * it is fine. Pass `allowVideo: false` for an event whose host has turned video
 * off; the server enforces the same rule, this just explains it up front.
 */
export function validateMediaFile(
  file: { type: string; size: number; name: string },
  options: { allowVideo?: boolean } = {},
): string | null {
  const { allowVideo = true } = options;
  const lowerName = file.name.toLowerCase();
  const browserOmittedType = file.type.trim() === '';
  const hasVideoExtension = ALLOWED_VIDEO_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  const isVideo = isAllowedVideoType(file.type) || (browserOmittedType && hasVideoExtension);

  if (isVideo) {
    if (!allowVideo) {
      return `"${file.name}" is a video, and this event accepts photos only.`;
    }
    if (file.size <= 0 || file.size > MAX_VIDEO_SIZE_BYTES) {
      return `"${file.name}" is larger than ${MAX_VIDEO_SIZE_LABEL}. Choose a shorter video and try again.`;
    }
    return null;
  }

  return validateImageFile(file);
}

/**
 * Reduce an untrusted filename to a safe S3-key suffix. Path separators, control
 * chars, and anything outside [a-z0-9._-] become '-'; consecutive dots (which
 * form `..` traversal sequences) collapse to one; and leading dots/dashes are
 * stripped so the result can never be `..`, a dotfile, or start a path segment.
 * The full key is always prefixed server-side, so this is defense-in-depth.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    // Drop the directory portion of any path the browser/OS may have included.
    .replace(/^.*[\\/]/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/\.{2,}/g, '.') // no `..`
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '') // no leading dot (dotfile) or dash
    .toLowerCase();
  return cleaned || 'file';
}

/**
 * Build the S3 key for a photo: events/{eventId}/photos/{stamp}-{filename}
 *
 * When the file's content hash is known it becomes the stamp, so re-uploading
 * the same bytes overwrites the same object instead of orphaning a second copy.
 * Without a hash the key falls back to a timestamp, exactly as before.
 */
export function buildPhotoKey(
  eventId: string,
  filename: string,
  now: Date = new Date(),
  contentHash?: string | null,
): string {
  const stamp = contentHash ? contentHash.slice(0, 32) : String(now.getTime());
  return `events/${eventId}/photos/${stamp}-${sanitizeFilename(filename)}`;
}

/**
 * One segment of a download filename: readable, but safe on every OS. Keeps
 * letters/digits, turns everything else into a single dash, and bounds the
 * length so a long event name can't produce an unusable filename.
 */
function filenameSegment(value: string, maxLength = 40): string {
  return value
    .normalize('NFKD')
    // Windows forbids \ / : * ? " < > | ; dashes are safe everywhere.
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

/**
 * The filename a guest or host actually receives: `001-Event-Name-Uploader.jpg`
 *
 * Deliberately NOT the S3 key. The key carries the content hash that drives
 * duplicate detection, and preview/thumb keys are derived from it by string
 * replacement — so it stays machine-shaped and this stays human-shaped.
 *
 * `index` is 1-based and zero-padded to three digits (wider only if an event
 * ever exceeds 999, so files keep sorting correctly). Missing pieces are simply
 * left out rather than rendered as "undefined".
 */
export function buildDownloadFilename(input: {
  /** 1-based position in the download; omitted from the name when absent. */
  index?: number;
  eventName?: string | null;
  uploadedBy?: string | null;
  /** Source key or filename, used only for the extension. */
  s3Key?: string | null;
}): string {
  const parts: string[] = [];

  if (typeof input.index === 'number' && Number.isFinite(input.index) && input.index > 0) {
    parts.push(String(Math.floor(input.index)).padStart(3, '0'));
  }
  const event = filenameSegment(input.eventName ?? '');
  if (event) parts.push(event);
  const uploader = filenameSegment(input.uploadedBy ?? '', 30);
  if (uploader) parts.push(uploader);

  // Extension from the stored key; default to .jpg for a still with none.
  const base = (input.s3Key ?? '').split('/').pop() ?? '';
  const match = base.match(/\.([a-zA-Z0-9]{1,5})$/);
  const extension = match ? `.${match[1].toLowerCase()}` : '.jpg';

  const stem = parts.join('-') || 'sharepix-photo';
  return `${stem}${extension}`;
}

/** Put a reduced-quality JPEG beside the original without exposing it as a download filename. */export function buildPreviewKey(originalKey: string): string {
  const withoutExtension = originalKey.replace(/\.[^/.]+$/, '');
  return `${withoutExtension.replace('/photos/', '/previews/')}-preview.jpg`;
}

/** Small low-res thumbnail key beside the original (for the post-window low-res phase). */
export function buildThumbKey(originalKey: string): string {
  const withoutExtension = originalKey.replace(/\.[^/.]+$/, '');
  return `${withoutExtension.replace('/photos/', '/thumbs/')}-thumb.jpg`;
}

/** Generate a short human-friendly event code, e.g. "K7MPQ2". */
export function generateEventCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no confusing 0/O, 1/I/L
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** Whether a gallery is still within its access window. */
export function isGalleryActive(accessExpiresAt?: string | null, now: Date = new Date()): boolean {
  if (!accessExpiresAt) return true;
  const expires = new Date(accessExpiresAt);
  return Number.isFinite(expires.getTime()) ? now < expires : true;
}

/**
 * Whether guests can still upload: the access window must be open AND the host
 * must not have closed the event. Server-side enforcement lives in
 * createEventPhoto; this mirrors it for the guest UI.
 */
export function isUploadOpen(
  event: { accessExpiresAt?: string | null; uploadsClosed?: boolean | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!event) return false;
  if (event.uploadsClosed) return false;
  return isGalleryActive(event.accessExpiresAt, now);
}
