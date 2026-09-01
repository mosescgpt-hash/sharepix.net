/**
 * Pure logic for the guest upload queue.
 *
 * The stateful hook (hooks/useMediaUpload) and both presentations (the default
 * UploadForm and the themed TCC experience) read the queue through these
 * functions, so the rules — what's valid, how far along a run is, which phase
 * the screen is in — live in one tested place rather than in JSX.
 */

import { isVideoFilename, validateMediaFile } from './validation';

export type MediaStatus = 'pending' | 'uploading' | 'done' | 'error' | 'duplicate';

export interface QueuedMedia {
  /** Stable across re-orders/removals, so previews and React keys don't churn. */
  id: string;
  file: File;
  status: MediaStatus;
  percent: number;
  error?: string;
  /**
   * True when this file failed a rule it can never pass — too large, wrong
   * type, or no video slots left. Retrying cannot help, so "Retry failed files"
   * must leave it alone.
   *
   * Without this the retry button cleared every error indiscriminately, and an
   * oversize video would upload in full: the guest burned the data, the server
   * correctly deleted the object on arrival, and the event was left having
   * spent a video slot on a file that no longer existed.
   */
  permanent?: boolean;
}

export interface QueueLimits {
  allowVideo: boolean;
  /** Videos the plan still has room for, or null when unlimited. */
  videosRemaining: number | null;
}

/**
 * Validate freshly-picked files and turn them into queue items, applying the
 * same rules the default form always has: per-file validation, and the
 * video-slot ceiling counted against videos already queued.
 */
export function buildQueuedFiles(
  files: File[],
  existing: QueuedMedia[],
  limits: QueueLimits,
  makeId: () => string,
): QueuedMedia[] {
  let videosTaken = existing.filter(
    (item) => item.status !== 'error' && isVideoFilename(item.file.name),
  ).length;

  return files.map((file) => {
    const problem = validateMediaFile(file, { allowVideo: limits.allowVideo });
    if (problem) {
      return { id: makeId(), file, status: 'error', percent: 0, error: problem, permanent: true };
    }

    if (isVideoFilename(file.name) && limits.videosRemaining !== null) {
      if (videosTaken >= limits.videosRemaining) {
        return {
          id: makeId(),
          file,
          status: 'error',
          percent: 0,
          permanent: true,
          error:
            limits.videosRemaining === 0
              ? 'This event has no video slots left. Photos are still welcome.'
              : `Only ${limits.videosRemaining} more video${limits.videosRemaining === 1 ? '' : 's'} can be added to this event. Photos are still welcome.`,
        };
      }
      videosTaken += 1;
    }
    return { id: makeId(), file, status: 'pending', percent: 0 };
  });
}

/**
 * What "Retry failed files" should produce.
 *
 * Only failures that could plausibly succeed on a second attempt are reset — a
 * dropped connection, a busy service. A file rejected by a rule is left exactly
 * as it was, with its message intact, because retrying it wastes the guest's
 * bandwidth and then fails server-side anyway.
 *
 * Transient failures are re-validated on the way back to `pending` rather than
 * trusted from the original pick: video slots may have been used up by someone
 * else since, and an item that has become invalid should stop here rather than
 * upload and be deleted on arrival.
 */
export function resetForRetry(queue: QueuedMedia[], limits: QueueLimits): QueuedMedia[] {
  // Videos still queued or already uploaded hold their slots.
  let videosTaken = queue.filter(
    (item) => item.status !== 'error' && isVideoFilename(item.file.name),
  ).length;

  return queue.map((item) => {
    if (item.status !== 'error') return item;
    if (item.permanent) return item;

    const problem = validateMediaFile(item.file, { allowVideo: limits.allowVideo });
    if (problem) {
      return { ...item, status: 'error', percent: 0, error: problem, permanent: true };
    }

    if (isVideoFilename(item.file.name) && limits.videosRemaining !== null) {
      if (videosTaken >= limits.videosRemaining) {
        return {
          ...item,
          status: 'error',
          percent: 0,
          permanent: true,
          error:
            limits.videosRemaining === 0
              ? 'This event has no video slots left. Photos are still welcome.'
              : `Only ${limits.videosRemaining} more video${limits.videosRemaining === 1 ? '' : 's'} can be added to this event. Photos are still welcome.`,
        };
      }
      videosTaken += 1;
    }

    return { ...item, status: 'pending', percent: 0, error: undefined };
  });
}

/** How many failed items the retry button can actually do anything about. */
export function retryableCount(queue: QueuedMedia[]): number {
  return queue.filter((item) => item.status === 'error' && !item.permanent).length;
}

export function isVideoItem(item: QueuedMedia): boolean {
  return isVideoFilename(item.file.name);
}

export interface QueueCounts {
  pending: number;
  uploading: number;
  done: number;
  duplicate: number;
  failed: number;
}

export function countsOf(queue: QueuedMedia[]): QueueCounts {
  const counts: QueueCounts = { pending: 0, uploading: 0, done: 0, duplicate: 0, failed: 0 };
  for (const item of queue) {
    if (item.status === 'pending') counts.pending += 1;
    else if (item.status === 'uploading') counts.uploading += 1;
    else if (item.status === 'done') counts.done += 1;
    else if (item.status === 'duplicate') counts.duplicate += 1;
    else if (item.status === 'error') counts.failed += 1;
  }
  return counts;
}

/**
 * Overall progress 0–100 across the items in a run. done/duplicate count as
 * complete; a pending item as 0; an uploading item by its own percent. Errors
 * are excluded — they aren't part of the in-flight total. Returns 0 when there
 * is nothing to weigh.
 */
export function overallPercent(queue: QueuedMedia[]): number {
  const inRun = queue.filter((item) => item.status !== 'error');
  if (inRun.length === 0) return 0;
  const total = inRun.reduce((sum, item) => {
    if (item.status === 'done' || item.status === 'duplicate') return sum + 100;
    if (item.status === 'uploading') return sum + item.percent;
    return sum;
  }, 0);
  return Math.round(total / inRun.length);
}

/**
 * Which screen the guest should see.
 *  - idle: nothing selected.
 *  - review: files chosen, not yet sent (there is something to send).
 *  - uploading: a send is in progress.
 *  - partial: the send finished but at least one file failed.
 *  - success: the send finished and every non-error file went through.
 *
 * `partial` outranks `success` so a mixed result never reads as a clean win.
 */
export type UploadPhase = 'idle' | 'review' | 'uploading' | 'partial' | 'success';

export function uploadPhase(queue: QueuedMedia[], busy: boolean): UploadPhase {
  if (queue.length === 0) return 'idle';
  if (busy) return 'uploading';
  const counts = countsOf(queue);
  // Still something ready to send (freshly picked, or retried) → review.
  if (counts.pending > 0) return 'review';
  if (counts.failed > 0) return 'partial';
  if (counts.done > 0 || counts.duplicate > 0) return 'success';
  return 'review';
}

/** Whether an upload may start: something pending and not already running. */
export function canStartUpload(queue: QueuedMedia[], busy: boolean): boolean {
  return !busy && countsOf(queue).pending > 0;
}
