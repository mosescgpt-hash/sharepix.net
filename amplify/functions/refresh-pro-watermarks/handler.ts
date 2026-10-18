import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});
const RESTAMP_FUNCTION = process.env.RESTAMP_FUNCTION_NAME ?? '';

/**
 * Queue a re-stamp of the caller's own previews. The photographer id comes
 * from the token, never the request, so nobody can restamp someone else's.
 */
export const handler = async (event: { identity?: unknown }) => {
  const identity = event.identity as { sub?: string } | null | undefined;
  const sub = identity?.sub ? String(identity.sub) : '';
  if (!sub) return { success: false, message: 'Sign in to change this.' };
  if (!RESTAMP_FUNCTION) return { success: false, message: 'Watermark updates are unavailable right now.' };
  await lambda.send(
    new InvokeCommand({
      FunctionName: RESTAMP_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ photographerId: sub })),
    }),
  );
  return {
    success: true,
    message: 'Updating the watermark on your photos. It takes a few minutes for a big event.',
  };
};
