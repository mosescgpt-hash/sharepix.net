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
 */
export const sanitizeUpload = defineFunction({
  name: 'sanitize-upload',
  resourceGroupName: 'storage',
  memoryMB: 512,
  timeoutSeconds: 60,
});
