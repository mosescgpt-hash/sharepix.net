import { defineFunction } from '@aws-amplify/backend';

/**
 * Signed URLs for stored media, served from Cloudflare R2.
 *
 * R2 charges nothing for egress, which on a Premium event is most of the cost
 * of running it — but reaching R2 needs a secret, so the signing has to happen
 * here rather than in the browser. That makes this the gate that replaces
 * Amplify Storage's own access rules for these reads: Amplify granted guests
 * blanket read on `events/*` and let the client pick the key, so moving the
 * choice to the server means stating the rules rather than assuming them. They
 * live in ./access, where they are tested.
 *
 * With R2 unconfigured this returns nothing and every caller falls back to S3,
 * which is exactly today's behaviour.
 */
export const mediaUrl = defineFunction({
  name: 'media-url',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
