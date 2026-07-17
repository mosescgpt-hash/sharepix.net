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
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

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

/** Human-readable reason an event photo or short video was rejected, or null if it is fine. */
export function validateMediaFile(file: { type: string; size: number; name: string }): string | null {
  const lowerName = file.name.toLowerCase();
  const browserOmittedType = file.type.trim() === '';
  const hasVideoExtension = ALLOWED_VIDEO_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  const isVideo = isAllowedVideoType(file.type) || (browserOmittedType && hasVideoExtension);

  if (isVideo) {
    if (file.size <= 0 || file.size > MAX_VIDEO_SIZE_BYTES) {
      return `"${file.name}" is larger than 100 MB. Choose a shorter video and try again.`;
    }
    return null;
  }

  return validateImageFile(file);
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
