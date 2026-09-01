// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { sniffMediaKind, maxBytesForKind } from './safety';
import { isJpeg, isHeic, stripJpegMetadata, stripHeicGps } from './exif';
import { mirrorConfigured, mirrorDecision, r2KeyFor } from './mirror';

const s3 = new S3Client({});

/**
 * Cloudflare R2, where reads are served from. R2 speaks the S3 API, so the same
 * client works against a different endpoint. Built lazily and only when fully
 * configured — with anything missing SharePix serves from S3 alone and this
 * whole path is inert.
 */
let r2Client: S3Client | null = null;
function r2(): S3Client | null {
  if (!mirrorConfigured(process.env)) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ACCOUNT_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

/**
 * Copy one object into R2. Best-effort by design: the file is already safe and
 * serveable from S3, so a mirror failure must degrade to "read it from S3"
 * rather than fail the upload or lose the photo.
 */
async function mirrorToR2(bucket: string, key: string) {
  const client = r2();
  if (!client) return;
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await readBytes(object.Body);
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: r2KeyFor(key),
        Body: Buffer.from(bytes),
        ContentType: object.ContentType,
      }),
    );
    console.log('Mirrored to R2', { at: new Date().toISOString(), key, bytes: bytes.length });
  } catch (error) {
    console.error('Could not mirror to R2 (serving from S3)', {
      at: new Date().toISOString(),
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Remove a rejected object's mirror, so a deleted upload cannot be served. */
async function removeFromR2(key: string) {
  const client = r2();
  if (!client) return;
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: r2KeyFor(key) }),
    );
  } catch {
    // Nothing to remove, or R2 is unreachable — the S3 delete is what counts.
  }
}

// Only vet uploaded originals. Previews and thumbnails are re-encoded from the
// original by the browser's canvas and written under sibling prefixes, so they
// don't need to be re-validated.
const ORIGINAL_KEY = /^events\/[^/]+\/photos\//;

async function readBytes(stream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

// Remove a rejected upload and its derived preview/thumb, best-effort.
async function deleteObjectAndDerivatives(bucket: string, key: string) {
  const derived = [
    key,
    key.replace('/photos/', '/previews/').replace(/\.[^/.]+$/, '') + '-preview.jpg',
    key.replace('/photos/', '/thumbs/').replace(/\.[^/.]+$/, '') + '-thumb.jpg',
  ];
  await Promise.all(
    derived.map((k) =>
      s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: k })).catch(() => undefined),
    ),
  );
}

async function reject(bucket: string, key: string, reason: string, detail: Record<string, unknown> = {}) {
  console.error('Rejected upload', { at: new Date().toISOString(), bucket, key, reason, ...detail });
  await deleteObjectAndDerivatives(bucket, key);
  // A rejected upload must not survive in the store reads are served from.
  await removeFromR2(key);
}

async function processRecord(record) {
  const bucket = record?.s3?.bucket?.name;
  const rawKey = record?.s3?.object?.key;
  if (!bucket || !rawKey) return;
  // S3 URL-encodes keys in event notifications (spaces as '+', etc.).
  const key = decodeURIComponent(String(rawKey).replace(/\+/g, ' '));

  // Previews and thumbs are re-encoded by the browser from the original, so
  // they carry no metadata and need no vetting — but they are what the gallery
  // serves, so they are exactly what we want in R2.
  if (!ORIGINAL_KEY.test(key)) {
    const derived = mirrorDecision({ key });
    if (derived.mirror) await mirrorToR2(bucket, key);
    return;
  }

  // Sniff the real type from the first bytes. A tiny ranged read is enough and
  // keeps large videos from being downloaded just to be identified.
  const headerObj = await s3
    .send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-31' }))
    .catch(() => null);
  if (!headerObj) return; // already gone
  const header = await readBytes(headerObj.Body);

  const kind = sniffMediaKind(header);
  if (!kind) {
    // The bytes are not a real image/video — a disguised file. Remove it.
    await reject(bucket, key, 'content-type-mismatch', {
      firstBytes: Array.from(header.slice(0, 8)),
    });
    return;
  }

  // Server-side size ceiling. The client checks this too, but a crafted upload
  // can bypass the UI, and S3 itself imposes no such limit. The event carries
  // the object size; fall back to a HEAD if it's ever absent.
  let size = record?.s3?.object?.size;
  if (typeof size !== 'number') {
    const head = await s3
      .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      .catch(() => null);
    size = head?.ContentLength ?? 0;
  }
  if (size > maxBytesForKind(kind)) {
    await reject(bucket, key, 'oversize', { size, kind });
    return;
  }

  await stripMetadata(bucket, key, header, headerObj.Metadata);

  // Mirror only once the bytes are final. A JPEG or HEIC is rewritten by
  // stripMetadata, and that rewrite fires its own event carrying
  // `sanitized: 'true'` — this pass deliberately skips it so the copy that
  // reaches R2 is the stripped one, never the guest's original.
  const strippable = isJpeg(header) || isHeic(header);
  const decision = mirrorDecision({
    key,
    strippable,
    sanitized: headerObj.Metadata?.sanitized === 'true',
  });
  if (decision.mirror) await mirrorToR2(bucket, key);
}

/**
 * Take the location data out of an uploaded original.
 *
 * A JPEG is rebuilt with everything but its orientation removed. A HEIC only
 * has its GPS values zeroed where they sit, because its container records
 * absolute file offsets and resizing the metadata would invalidate them.
 *
 * Best-effort throughout: the photo is already validated and visible, so a
 * failure here leaves it exactly as uploaded rather than breaking the gallery.
 */
async function stripMetadata(
  bucket: string,
  key: string,
  header: Uint8Array,
  metadata: Record<string, string> | undefined,
) {
  // Our own rewrite fires another ObjectCreated event. The marker below is how
  // that second pass knows to stop, so this never loops.
  if (metadata?.sanitized === 'true') return;
  // JPEG loses all metadata; HEIC only its GPS, in place — see docs/moderation.md.
  const jpeg = isJpeg(header);
  if (!jpeg && !isHeic(header)) return;

  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await readBytes(object.Body);
    const stripped = jpeg ? stripJpegMetadata(bytes) : stripHeicGps(bytes);
    if (!stripped) return; // nothing to remove, or the file looked malformed

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(stripped),
        ContentType: object.ContentType ?? (jpeg ? 'image/jpeg' : 'image/heic'),
        Metadata: { ...(object.Metadata ?? {}), sanitized: 'true' },
        MetadataDirective: 'REPLACE',
      }),
    );
    console.log('Stripped photo metadata', {
      at: new Date().toISOString(),
      key,
      before: bytes.length,
      after: stripped.length,
    });
  } catch (error) {
    console.error('Could not strip photo metadata', {
      at: new Date().toISOString(),
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * S3 ObjectCreated trigger. Each record is handled independently and never
 * throws: an unhandled error would make S3 retry the whole event.
 */
export const handler = async (event: { Records?: unknown[] }) => {
  for (const record of event.Records ?? []) {
    try {
      await processRecord(record);
    } catch (err) {
      console.error('sanitize-upload record failed', err);
    }
  }
  return { ok: true };
};
