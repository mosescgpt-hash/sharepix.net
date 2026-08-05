// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { sniffMediaKind, maxBytesForKind } from './safety';

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
