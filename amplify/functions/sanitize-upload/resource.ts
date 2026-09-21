import { defineFunction } from '@aws-amplify/backend';

/**
 * S3 upload sanitizer. Runs on every object created under the photos bucket
 * (wired as the storage `onUpload` trigger). For an uploaded original it:
 *   - verifies the ACTUAL bytes are a real image/video (defeats a disguised
 *     HTML/SVG/script/executable that slipped past the client's MIME check), and
 *   - enforces the server-side size ceiling.
 * Anything that fails validation is deleted from the bucket. It then strips
 * location metadata from JPEG originals, keeping their orientation.
 *
 * Type checks read only the first bytes (a ranged GET), so videos stay cheap;
 * only a JPEG is ever downloaded in full, and those are capped at 25 MB.
 *
 * ## The two numbers
 *
 * **512 MB** although a video may be 250 MB. Nothing here holds a video in
 * memory: `video.ts` finds the metadata with sixteen-byte ranged reads, fetches
 * only the `moov` box, and streams the rewrite through a transform. Raising
 * this would cost more on every upload — and photos, which are the overwhelming
 * majority, return long before any of that.
 *
 * **120 seconds**, up from 60. A video that actually carries coordinates is
 * streamed down and back up: 250 MB each way at the bandwidth this memory tier
 * gets is on the order of fifteen seconds, and the ceiling has to clear the
 * worst case rather than the normal one. A timeout mid-rewrite leaves the
 * original untouched, so the cost of being wrong is a missed strip — but that
 * is a hole in a privacy claim, which is exactly what should not depend on a
 * guest's clip being average-sized.
 */
export const sanitizeUpload = defineFunction({
  name: 'sanitize-upload',
  resourceGroupName: 'storage',
  memoryMB: 512,
  timeoutSeconds: 120,
});
