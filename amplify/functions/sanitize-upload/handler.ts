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
import { isJpeg, stripJpegMetadata } from './exif';

const s3 = new S3Client({});

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

function reject(bucket: string, key: string, reason: string, detail: Record<string, unknown> = {}) {
  console.error('Rejected upload', { at: new Date().toISOString(), bucket, key, reason, ...detail });
  return deleteObjectAndDerivatives(bucket, key);
}

async function processRecord(record) {
  const bucket = record?.s3?.bucket?.name;
  const rawKey = record?.s3?.object?.key;
  if (!bucket || !rawKey) return;
  // S3 URL-encodes keys in event notifications (spaces as '+', etc.).
  const key = decodeURIComponent(String(rawKey).replace(/\+/g, ' '));

  if (!ORIGINAL_KEY.test(key)) return;

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
}

/**
 * Remove location and other metadata from a JPEG original, keeping only its
 * orientation so the photo still displays the right way up.
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
  if (!isJpeg(header)) return; // only JPEG is handled — see docs/moderation.md

  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await readBytes(object.Body);
    const stripped = stripJpegMetadata(bytes);
    if (!stripped) return; // nothing to remove, or the file looked malformed

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(stripped),
        ContentType: object.ContentType ?? 'image/jpeg',
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
