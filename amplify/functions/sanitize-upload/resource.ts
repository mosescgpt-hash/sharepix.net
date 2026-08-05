import { defineFunction } from '@aws-amplify/backend';

/**
 * S3 upload sanitizer. Runs on every object created under the photos bucket
 * (wired as the storage `onUpload` trigger). For an uploaded original it:
 *   - verifies the ACTUAL bytes are a real image/video (defeats a disguised
 *     HTML/SVG/script/executable that slipped past the client's MIME check), and
 *   - enforces the server-side size ceiling.
 * Anything that fails validation is deleted from the bucket. It only reads each
 * object's first bytes (a ranged GET), so it stays cheap even for large videos.
 */
export const sanitizeUpload = defineFunction({
  name: 'sanitize-upload',
  resourceGroupName: 'storage',
  memoryMB: 256,
  timeoutSeconds: 30,
});
