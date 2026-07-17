/** Allowed image MIME types for guest uploads. */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
];

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export function isAllowedImageType(mimeType: string): boolean {
  return ALLOWED_IMAGE_TYPES.includes(mimeType.toLowerCase());
}

export function isAllowedFileSize(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_FILE_SIZE_BYTES;
}

/** Human-readable reason a file was rejected, or null if it is fine. */
export function validateImageFile(file: { type: string; size: number; name: string }): string | null {
  if (!isAllowedImageType(file.type)) {
    return `"${file.name}" is not a supported image type. Use JPG, PNG, GIF, WEBP, or HEIC.`;
  }
  if (!isAllowedFileSize(file.size)) {
    return `"${file.name}" is larger than 25 MB. Resize it and try again.`;
  }
  return null;
}

/** Strip characters that are unsafe in S3 keys. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .toLowerCase();
}

/** Build the S3 key for a photo: events/{eventId}/photos/{timestamp}-{filename} */
export function buildPhotoKey(eventId: string, filename: string, now: Date = new Date()): string {
  return `events/${eventId}/photos/${now.getTime()}-${sanitizeFilename(filename)}`;
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
