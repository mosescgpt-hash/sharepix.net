import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  backfillVerdict,
  summarise,
  type BackfillReason,
} from '../lib/r2Backfill';

/**
 * Copy into R2 anything that predates R2 mirroring.
 *
 * R2 mirroring shipped 1 September 2026. Photos uploaded before that live only
 * in S3, so every gallery view of an older event asks R2, gets a 404, waits,
 * and falls back — a doubled request per photo and S3 egress on reads R2 would
 * serve free.
 *
 * Idempotent: it HEADs R2 before every copy, so a second run copies nothing and
 * a run interrupted halfway simply resumes.
 *
 *   npm run backfill:r2                  # dry run — lists, copies nothing
 *   npm run backfill:r2 -- --apply       # actually copies
 *   npm run backfill:r2 -- --event <id>  # one event only
 *
 * Needs the S3 bucket (from amplify_outputs.json, or BUCKET_NAME) and the same
 * four R2 variables the Lambdas use. It reads from S3 and writes to R2; it
 * never deletes, and never writes to S3.
 */

const APPLY = process.argv.includes('--apply');
const eventFlag = process.argv.indexOf('--event');
const ONLY_EVENT = eventFlag !== -1 ? process.argv[eventFlag + 1] : undefined;

function bucketName(): string {
  if (process.env.BUCKET_NAME) return process.env.BUCKET_NAME;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const outputs = require('../amplify_outputs.json');
    const name = outputs?.storage?.bucket_name;
    if (name) return name as string;
  } catch {
    // Fall through to the error below, which says what to do about it.
  }
  throw new Error(
    'No S3 bucket. Run `npx ampx sandbox` to write amplify_outputs.json, or set BUCKET_NAME.',
  );
}

function r2Client(): S3Client {
  const endpoint = process.env.R2_ACCOUNT_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !process.env.R2_BUCKET || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Set R2_ACCOUNT_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY ' +
        '(the same four the Lambdas use — see docs/deploying.md).',
    );
  }
  return new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
}

async function readAll(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main() {
  const bucket = bucketName();
  const s3 = new S3Client({});
  const r2 = r2Client();
  const r2Bucket = process.env.R2_BUCKET as string;
  const prefix = ONLY_EVENT ? `events/${ONLY_EVENT}/` : 'events/';

  console.log(
    `${APPLY ? 'Copying' : 'DRY RUN — listing only'}: s3://${bucket}/${prefix} -> r2://${r2Bucket}`,
  );
  if (!APPLY) console.log('Nothing will be written. Re-run with --apply to copy.\n');

  const counts: Record<BackfillReason, number> = {
    'derived-variant': 0,
    'original-sanitized': 0,
    'original-not-strippable': 0,
    'already-in-r2': 0,
    'unstripped-original': 0,
    'unknown-prefix': 0,
  };
  const refused: string[] = [];
  let copiedBytes = 0;
  let scanned = 0;
  let token: string | undefined;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (!key || key.endsWith('/')) continue;
      scanned += 1;

      // Ask R2 first. This is what makes the script idempotent, and it is one
      // cheap HEAD against a store with no egress charge.
      const inR2 = await r2
        .send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }))
        .then(() => true)
        .catch(() => false);

      // Only look up S3 metadata when the answer could depend on it — a HEAD
      // per object would otherwise double the work to learn nothing.
      let sanitized: boolean | undefined;
      if (!inR2 && /^events\/[^/]+\/photos\//.test(key)) {
        const head = await s3
          .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
          .catch(() => null);
        sanitized = head?.Metadata?.sanitized === 'true';
      }

      const verdict = backfillVerdict({ key, inR2, sanitized });
      counts[verdict.reason] += 1;
      if (verdict.reason === 'unstripped-original') refused.push(key);

      if (!verdict.copy) continue;

      if (!APPLY) {
        console.log(`  would copy  ${key}  (${verdict.reason})`);
        continue;
      }

      const source = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = await readAll(source.Body);
      await r2.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: key,
          Body: body,
          ContentType: source.ContentType,
        }),
      );
      copiedBytes += body.byteLength;
      console.log(`  copied      ${key}  (${(body.byteLength / 1024).toFixed(0)} kB)`);
    }
    token = page.NextContinuationToken;
  } while (token);

  console.log(`\nScanned ${scanned} objects.`);
  console.log(summarise(counts));
  if (APPLY) console.log(`Copied ${(copiedBytes / 1024 / 1024).toFixed(1)} MB into R2.`);

  if (refused.length > 0) {
    console.log('\nRefused (no `sanitized` metadata — EXIF may still be present):');
    for (const key of refused.slice(0, 20)) console.log(`  ${key}`);
    if (refused.length > 20) console.log(`  …and ${refused.length - 20} more`);
    console.log(
      '\nThese are left in S3 deliberately. The gallery serves previews, which are\n' +
        'unaffected, so a refusal here costs nothing but the original staying on S3.',
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
