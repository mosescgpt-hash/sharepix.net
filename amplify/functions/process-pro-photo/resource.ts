import { defineFunction } from '@aws-amplify/backend';

/**
 * Makes the preview and thumbnail a guest will see, from the original a
 * photographer sent.
 *
 * Server-side because the resolution guarantee has to be ours. A preview built
 * in the uploader's browser is whatever that client says it is, and a modified
 * client could label a full-resolution file "preview" — which is exactly the
 * frontend-enforced rule the brief rules out.
 *
 * Jimp rather than Sharp: Sharp is a native module, and bundled the way
 * Amplify bundles it, esbuild reports success and produces an artifact that
 * throws "Could not load the sharp module" at runtime. It would have deployed
 * green and died on the first photograph. Jimp is pure JavaScript, so no
 * Lambda layer, no container image, and no new infrastructure.
 *
 * Sized for the work: Jimp decodes to raw RGBA, so a 24 MP frame is roughly
 * 100 MB of bitmap before any copies.
 */
export const processProPhoto = defineFunction({
  name: 'process-pro-photo',
  // 'data' for the same reason as pro-upload: it reads three data tables, and
  // a storage-stack function granted from data closes a cycle that
  // scripts/check-stack-cycles.mjs rejects. Synthesis does not detect it.
  resourceGroupName: 'data',
  memoryMB: 1536,
  timeoutSeconds: 120,
});
