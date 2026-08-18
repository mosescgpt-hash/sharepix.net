// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
// Imported, not copied. A test that built its own version of the message would
// prove the test works, not that the alert does.
import { buildAlertEmail, sanitizeHeaderValue } from '../create-event-photo/alert-email';

const ses = new SESv2Client({});
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET_NAME = process.env.BUCKET_NAME as string;

/** Shaped like a real one (the builder only accepts hex), but resolves to nothing. */
const TEST_TOKEN = '0'.repeat(32);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A preview from a real photo, so the test exercises the same S3 fetch and
 * inline-attachment path the alert uses. Bounded scan: this runs by hand, a few
 * times ever, and only needs one usable image.
 */
async function samplePreview(): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
  const found = await dynamo
    .send(new ScanCommand({ TableName: PHOTO_TABLE, Limit: 50 }))
    .catch(() => null);
  const key = (found?.Items ?? []).map((item) => item.previewS3Key?.S).find(Boolean);
  if (!key) return undefined;

  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as AsyncIterable<Buffer>) chunks.push(chunk);
    const bytes = new Uint8Array(Buffer.concat(chunks));
    // Same ceiling the real alert applies, so a message that sends here sends there.
    if (bytes.byteLength > 4 * 1024 * 1024) return undefined;
    return { bytes, contentType: object.ContentType ?? 'image/jpeg' };
  } catch {
    return undefined;
  }
}

export const handler = async (event) => {
  const from = process.env.ALERT_FROM_ADDRESS;
  if (!from) {
    return {
      success: false,
      message:
        'ALERT_FROM_ADDRESS is not set on this deployment, so no alert email can be sent at all. Set it to a verified SES address in the Amplify console and redeploy.',
    };
  }

  // The recipient is the signed-in admin, taken from their token — never from
  // the request. An address argument would turn an admin action into a way to
  // send mail from our verified domain to anyone.
  const identity = event?.identity as { claims?: Record<string, unknown> } | undefined;
  const claimed = String(identity?.claims?.email ?? '').trim();
  if (!EMAIL.test(claimed)) {
    return {
      success: false,
      message:
        'Your account has no email address on it, so there is nowhere to send the test. Sign in with an email account and try again.',
    };
  }
  const to = sanitizeHeaderValue(claimed);

  const appUrl = process.env.APP_URL ?? 'https://www.sharepix.net';
  const image = await samplePreview();

  try {
    await ses.send(
      new SendEmailCommand({
        Content: {
          Raw: {
            Data: Buffer.from(
              buildAlertEmail({
                from,
                to,
                eventName: 'Test event (no photo was held)',
                reasons: 'This is a test — nothing was flagged',
                reviewUrl: `${appUrl}/review/${TEST_TOKEN}`,
                image,
              }),
            ),
          },
        },
      }),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // The two failures worth naming, because the fix differs.
    const hint = /not verified/i.test(detail)
      ? ` — ${from} is not a verified sender in this Lambda's region. SES identities are per-region: verify the domain in the region the app runs in.`
      : /sandbox|not authorized to send/i.test(detail)
        ? ` — the account is still in the SES sandbox, which only delivers to verified addresses. Request production access.`
        : '';
    return { success: false, message: `Send failed: ${detail}${hint}` };
  }

  console.log('Test alert sent', { at: new Date().toISOString(), hasImage: Boolean(image) });

  return {
    success: true,
    message: [
      `Sent to ${to} from ${from}.`,
      image
        ? 'It includes a real photo preview from your events, embedded the same way a real alert embeds it.'
        : 'No photo preview was available, so it went text-only — the real alert embeds one.',
      'The Approve and Deny buttons point at a test token, so they will say the link is invalid. That is expected.',
      'If it does not arrive within a minute, check spam — and if it is there, that is worth fixing before a real event.',
    ].join(' '),
  };
};
