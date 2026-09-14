import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { Schema } from '../../data/resource';
import { backfillVerdict, summarise, type BackfillReason } from './backfillDecision';

type Handler = Schema['backfillR2']['functionHandler'];

/**
 * Copy into R2 whatever predates R2 mirroring.
 *
 * Mirroring shipped on 1 September 2026. Anything uploaded before that is in S3
 * only, so the gallery asks R2, gets a 404, waits, and falls back — a doubled
 * request per photo and S3 egress billed for reads R2 would serve free.
 *
 * ## Why this is a Lambda and not only a script
 *
 * `scripts/backfill-r2.ts` does the same job, but it needs an AWS profile and
 * all four R2 values on someone's laptop. Here they already exist. The
 * operator's own machine is also the one place the production bucket name can
 * be got wrong — a local `amplify_outputs.json` points at a *sandbox* bucket,
 * and a run against the wrong bucket reports "nothing to copy" and looks like
 * success.
 *
 * ## Why it returns a token instead of finishing
 *
 * A Lambda cannot run unbounded. This works to a time budget well inside the
 * timeout and returns wherever it stopped, so the caller can press the button
 * again. Stopping early is normal, not a failure, and the summary says so.
 *
 * Idempotent throughout: every object is HEADed in R2 first, so a repeat run
 * copies nothing and an interrupted one resumes.
 */

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME as string;

/**
 * Stop working after this long and hand back a token.
 *
 * The function's timeout is 900s. Twelve minutes leaves three for the copy in
 * flight to finish and the response to be written, which matters because a
 * timeout would lose the token and make the next run start from the beginning.
 */
const TIME_BUDGET_MS = 12 * 60 * 1000;

function r2(): S3Client | null {
  const endpoint = process.env.R2_ACCOUNT_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !process.env.R2_BUCKET || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
}

export const handler: Handler = async (event) => {
  const apply = event.arguments.apply === true;
  const eventId = event.arguments.eventId?.trim() || null;
  const startToken = event.arguments.nextToken?.trim() || undefined;

  const client = r2();
  if (!client) {
    return {
      success: false,
      message:
        'R2 is not configured on this function. Set R2_ACCOUNT_ENDPOINT, R2_BUCKET, ' +
        'R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in Amplify and redeploy — they are read ' +
        'when the backend is built, not when this runs.',
    };
  }
  const r2Bucket = process.env.R2_BUCKET as string;
  const prefix = eventId ? `events/${eventId}/` : 'events/';

  const counts: Record<BackfillReason, number> = {
    'derived-variant': 0,
    'original-sanitized': 0,
    'original-not-strippable': 0,
    'already-in-r2': 0,
    'unstripped-original': 0,
    'unknown-prefix': 0,
  };
  const refused: string[] = [];
  let scanned = 0;
  let copied = 0;
  let copiedBytes = 0;
  let token: string | undefined = startToken;
  // The token that fetched the page being worked on. On a timeout this is what
  // the caller resumes with, so the interrupted page is re-listed rather than
  // skipped — every object on it is HEADed again and the copied ones fall out.
  let pageToken: string | undefined = startToken;
  let ranOutOfTime = false;
  let exhausted = false;
  const startedAt = Date.now();

  try {
    do {
      pageToken = token;
      const page: ListObjectsV2CommandOutput = await s3.send(
        new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
      );

      for (const object of page.Contents ?? []) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          ranOutOfTime = true;
          break;
        }
        const key = object.Key;
        if (!key || key.endsWith('/')) continue;
        scanned += 1;

        const inR2 = await client
          .send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }))
          .then(() => true)
          .catch(() => false);

        // Only pay for an S3 HEAD when the verdict could depend on it.
        let sanitized: boolean | undefined;
        if (!inR2 && /^events\/[^/]+\/photos\//.test(key)) {
          const head = await s3
            .send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
            .catch(() => null);
          sanitized = head?.Metadata?.sanitized === 'true';
        }

        const verdict = backfillVerdict({ key, inR2, sanitized });
        counts[verdict.reason] += 1;
        if (verdict.reason === 'unstripped-original') refused.push(key);
        if (!verdict.copy || !apply) continue;

        // Streamed with the length from the listing rather than buffered: a
        // video can be hundreds of megabytes and this function should not need
        // to hold one in memory to copy it.
        const source = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        await client.send(
          new PutObjectCommand({
            Bucket: r2Bucket,
            Key: key,
            // In Lambda the SDK's body is a Node Readable. The union it is
            // typed as spans other runtimes, so the cast names the one this
            // actually runs in rather than widening the call.
            Body: source.Body as Readable,
            ContentLength: object.Size,
            ContentType: source.ContentType,
          }),
        );
        copied += 1;
        copiedBytes += object.Size ?? 0;
      }

      if (ranOutOfTime) break;
      token = page.NextContinuationToken;
      if (!token) exhausted = true;
    } while (token);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('Backfill failed', { at: new Date().toISOString(), scanned, copied, detail });
    return {
      success: false,
      message:
        `Stopped after ${scanned} objects (${copied} copied): ${detail}\n\n` +
        'Nothing is half-copied — each object is written whole or not at all, and a ' +
        're-run skips what already made it.',
    };
  }

  const lines = [
    apply
      ? `Copied ${copied} object${copied === 1 ? '' : 's'} (${(copiedBytes / 1024 / 1024).toFixed(1)} MB) into R2.`
      : `DRY RUN — nothing was written. Scanned ${scanned} objects.`,
    '',
    summarise(counts),
  ];

  if (ranOutOfTime) {
    lines.push(
      '',
      'Stopped on the time budget, which is expected on a large bucket and is not a ' +
        'failure. Press the button again to carry on from here.',
    );
  }
  if (refused.length > 0) {
    lines.push('', 'Refused (no `sanitized` metadata, so EXIF may still be on them):');
    for (const key of refused.slice(0, 10)) lines.push(`  ${key}`);
    if (refused.length > 10) lines.push(`  …and ${refused.length - 10} more`);
    lines.push(
      'Left in S3 on purpose. Galleries serve previews, which are unaffected.',
    );
  }
  if (!apply && counts['already-in-r2'] === scanned && scanned > 0) {
    lines.push('', 'Everything here is already in R2. Nothing to do.');
  }

  console.log('Backfill complete', {
    at: new Date().toISOString(),
    apply,
    prefix,
    scanned,
    copied,
    ranOutOfTime,
  });

  return {
    success: true,
    message: lines.join('\n').trim(),
    // `done` is the flag to act on, not the token. A run can stop on the budget
    // during the very first page, where there is no token to hand back — and
    // reporting that as finished is exactly how a half-done backfill would look
    // complete. Resuming without a token restarts the listing, which is
    // wasteful but never wrong, because copied objects are skipped.
    done: exhausted && !ranOutOfTime,
    nextToken: ranOutOfTime ? (pageToken ?? null) : null,
  };
};
