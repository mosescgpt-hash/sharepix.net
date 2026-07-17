import {
  buildPhotoKey,
  buildPreviewKey,
  generateEventCode,
  isAllowedImageType,
  isAllowedVideoType,
  isGalleryActive,
  isVideoFilename,
  sanitizeFilename,
  validateImageFile,
  validateMediaFile,
} from '../lib/validation';
import { computeAccessExpiresAt, getTier } from '../lib/pricing';

describe('image validation', () => {
  it('accepts common image types', () => {
    expect(isAllowedImageType('image/jpeg')).toBe(true);
    expect(isAllowedImageType('image/PNG')).toBe(true);
    expect(isAllowedImageType('image/heic')).toBe(true);
  });

  it('rejects non-image types', () => {
    expect(isAllowedImageType('application/pdf')).toBe(false);
    expect(isAllowedImageType('video/mp4')).toBe(false);
  });

  it('rejects oversized files with a helpful message', () => {
    const result = validateImageFile({
      type: 'image/jpeg',
      size: 30 * 1024 * 1024,
      name: 'huge.jpg',
    });
    expect(result).toContain('25 MB');
  });

  it('returns null for a valid file', () => {
    const result = validateImageFile({
      type: 'image/png',
      size: 2 * 1024 * 1024,
      name: 'good.png',
    });
    expect(result).toBeNull();
  });

  it('accepts an iPhone HEIC photo when the browser omits its MIME type', () => {
    const result = validateImageFile({
      type: '',
      size: 3 * 1024 * 1024,
      name: 'IMG_1234.HEIC',
    });
    expect(result).toBeNull();
  });

  it('accepts AVIF photos', () => {
    const result = validateImageFile({
      type: 'image/avif',
      size: 3 * 1024 * 1024,
      name: 'photo.avif',
    });
    expect(result).toBeNull();
  });

  it('does not trust an image extension when the browser reports a non-image MIME type', () => {
    const result = validateImageFile({
      type: 'application/pdf',
      size: 1024,
      name: 'not-really-a-photo.jpg',
    });
    expect(result).toContain('not a supported image type');
  });
});

describe('video validation', () => {
  it('accepts common iPhone, Android, and web video types', () => {
    expect(isAllowedVideoType('video/mp4')).toBe(true);
    expect(isAllowedVideoType('video/quicktime')).toBe(true);
    expect(isAllowedVideoType('video/webm')).toBe(true);
  });

  it('recognizes video filenames for gallery playback', () => {
    expect(isVideoFilename('events/abc/photos/clip.MOV')).toBe(true);
    expect(isVideoFilename('events/abc/photos/image.jpg')).toBe(false);
  });

  it('accepts a short video and rejects one over 100 MB', () => {
    expect(validateMediaFile({ type: 'video/mp4', size: 20 * 1024 * 1024, name: 'clip.mp4' })).toBeNull();
    expect(validateMediaFile({ type: 'video/mp4', size: 101 * 1024 * 1024, name: 'long.mp4' })).toContain('100 MB');
  });

  it('accepts an iPhone MOV when the browser omits its MIME type', () => {
    expect(validateMediaFile({ type: '', size: 20 * 1024 * 1024, name: 'IMG_1234.MOV' })).toBeNull();
  });
});

describe('S3 keys', () => {
  it('sanitizes unsafe filename characters', () => {
    expect(sanitizeFilename("My Photo (1)!.JPG")).toBe('my-photo-1-.jpg');
  });

  it('builds keys under the expected event path', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const key = buildPhotoKey('abc123', 'party pic.png', now);
    expect(key).toBe(`events/abc123/photos/${now.getTime()}-party-pic.png`);
  });

  it('builds a separate JPEG preview key', () => {
    expect(buildPreviewKey('events/evt/photos/1234-camera.heic')).toBe(
      'events/evt/previews/1234-camera-preview.jpg',
    );
  });
});

describe('event codes', () => {
  it('generates codes of the requested length from the safe alphabet', () => {
    const code = generateEventCode(6);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
  });
});

describe('gallery access windows', () => {
  it('is active before expiry and inactive after', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(isGalleryActive('2026-07-01T00:00:00Z', now)).toBe(true);
    expect(isGalleryActive('2026-05-01T00:00:00Z', now)).toBe(false);
  });

  it('treats missing expiry as active', () => {
    expect(isGalleryActive(null)).toBe(true);
  });
});

describe('pricing', () => {
  it('exposes the three tiers with correct prices', () => {
    expect(getTier('starter')?.price).toBe(10);
    expect(getTier('standard')?.price).toBe(25);
    expect(getTier('premium')?.price).toBe(50);
  });

  it('computes expiry based on tier access days', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const starterExpiry = new Date(computeAccessExpiresAt('starter', from));
    const diffDays = (starterExpiry.getTime() - from.getTime()) / 86400000;
    expect(diffDays).toBe(14);
  });
});
