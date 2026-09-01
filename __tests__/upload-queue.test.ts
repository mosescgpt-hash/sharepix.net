import {
  buildQueuedFiles,
  canStartUpload,
  countsOf,
  overallPercent,
  QueuedMedia,
  resetForRetry,
  retryableCount,
  uploadPhase,
} from '../lib/uploadQueue';
import { MAX_VIDEO_SIZE_BYTES } from '../lib/validation';

// A minimal File stand-in — buildQueuedFiles only reads name/type/size, and
// validateMediaFile (already tested on its own) does the real checks.
function file(name: string, type = 'image/jpeg', size = 1_000): File {
  return { name, type, size } as unknown as File;
}

let counter = 0;
const makeId = () => `id${(counter += 1)}`;
beforeEach(() => {
  counter = 0;
});

function item(partial: Partial<QueuedMedia>): QueuedMedia {
  return { id: makeId(), file: file('a.jpg'), status: 'pending', percent: 0, ...partial };
}

describe('buildQueuedFiles', () => {
  it('keeps valid photos as pending and preserves order', () => {
    const out = buildQueuedFiles(
      [file('a.jpg'), file('b.png', 'image/png')],
      [],
      { allowVideo: true, videosRemaining: null },
      makeId,
    );
    expect(out.map((i) => i.status)).toEqual(['pending', 'pending']);
    expect(out.map((i) => i.id)).toEqual(['id1', 'id2']);
  });

  it('still enforces file validation (an unsupported type is flagged, not sent)', () => {
    const out = buildQueuedFiles(
      [file('evil.exe', 'application/x-msdownload')],
      [],
      { allowVideo: true, videosRemaining: null },
      makeId,
    );
    expect(out[0].status).toBe('error');
    expect(out[0].error).toBeTruthy();
  });

  it('rejects video when the event has none left, but still takes photos', () => {
    const out = buildQueuedFiles(
      [file('clip.mp4', 'video/mp4'), file('pic.jpg')],
      [],
      { allowVideo: true, videosRemaining: 0 },
      makeId,
    );
    expect(out[0].status).toBe('error');
    expect(out[0].error).toMatch(/no video slots/i);
    expect(out[1].status).toBe('pending');
  });

  it('counts videos already queued against the remaining slots', () => {
    const existing = [item({ file: file('one.mov', 'video/quicktime') })];
    const out = buildQueuedFiles(
      [file('two.mov', 'video/quicktime')],
      existing,
      { allowVideo: true, videosRemaining: 1 },
      makeId,
    );
    // One slot, one already queued → this one is over the line.
    expect(out[0].status).toBe('error');
  });
});

describe('counts and progress', () => {
  it('tallies statuses', () => {
    const queue = [
      item({ status: 'pending' }),
      item({ status: 'uploading', percent: 50 }),
      item({ status: 'done' }),
      item({ status: 'duplicate' }),
      item({ status: 'error' }),
    ];
    expect(countsOf(queue)).toEqual({ pending: 1, uploading: 1, done: 1, duplicate: 1, failed: 1 });
  });

  it('averages progress over the run, excluding errors', () => {
    expect(overallPercent([])).toBe(0);
    expect(overallPercent([item({ status: 'pending' }), item({ status: 'done' })])).toBe(50);
    expect(
      overallPercent([item({ status: 'uploading', percent: 40 }), item({ status: 'error' })]),
    ).toBe(40); // the error is not part of the in-flight total
  });
});

describe('uploadPhase', () => {
  it('is idle with nothing selected', () => {
    expect(uploadPhase([], false)).toBe('idle');
  });

  it('is review once files are chosen', () => {
    expect(uploadPhase([item({ status: 'pending' })], false)).toBe('review');
  });

  it('is uploading while busy', () => {
    expect(uploadPhase([item({ status: 'uploading', percent: 10 })], true)).toBe('uploading');
  });

  it('is success only when everything went through', () => {
    expect(uploadPhase([item({ status: 'done' }), item({ status: 'duplicate' })], false)).toBe('success');
  });

  it('is partial when any file failed, never a false success', () => {
    expect(uploadPhase([item({ status: 'done' }), item({ status: 'error' })], false)).toBe('partial');
  });

  it('returns to review after a retry re-arms the failed files', () => {
    expect(uploadPhase([item({ status: 'pending' }), item({ status: 'done' })], false)).toBe('review');
  });
});

describe('canStartUpload prevents duplicate submissions', () => {
  it('allows a start only when idle with pending work', () => {
    expect(canStartUpload([item({ status: 'pending' })], false)).toBe(true);
  });

  it('blocks a start while a run is in progress', () => {
    expect(canStartUpload([item({ status: 'pending' })], true)).toBe(false);
  });

  it('blocks a start when nothing is pending', () => {
    expect(canStartUpload([item({ status: 'done' })], false)).toBe(false);
  });
});

describe('resetForRetry — the oversize-video retry bug', () => {
  const limits = { allowVideo: true, videosRemaining: null };
  const huge = () => file('party.mp4', 'video/mp4', MAX_VIDEO_SIZE_BYTES + 1);

  it('refuses to retry a video rejected for its size', () => {
    // Reported from real use: a video too large to upload was rejected, and
    // tapping "Retry failed files" uploaded it anyway. The whole file went up,
    // the server deleted it on arrival, and the event still spent a video slot.
    const queued = buildQueuedFiles([huge()], [], limits, makeId);
    expect(queued[0].status).toBe('error');
    expect(queued[0].permanent).toBe(true);

    const afterRetry = resetForRetry(queued, limits);
    expect(afterRetry[0].status).toBe('error');
    expect(afterRetry[0].error).toContain('larger than');
  });

  it('still retries a genuine transient failure', () => {
    const failed = [item({ status: 'error', error: 'The service was busy.' })];
    const afterRetry = resetForRetry(failed, limits);
    expect(afterRetry[0].status).toBe('pending');
    expect(afterRetry[0].error).toBeUndefined();
    expect(afterRetry[0].percent).toBe(0);
  });

  it('leaves anything not in error untouched', () => {
    const queue = [
      item({ status: 'done', percent: 100 }),
      item({ status: 'duplicate' }),
      item({ status: 'pending' }),
    ];
    expect(resetForRetry(queue, limits)).toEqual(queue);
  });

  it('re-checks a transient failure rather than trusting the original pick', () => {
    // An item can become invalid between the pick and the retry — here the
    // event has since run out of video slots.
    const failed = [
      item({ file: file('clip.mp4', 'video/mp4', 1_000), status: 'error', error: 'Network error' }),
    ];
    const afterRetry = resetForRetry(failed, { allowVideo: true, videosRemaining: 0 });
    expect(afterRetry[0].status).toBe('error');
    expect(afterRetry[0].permanent).toBe(true);
    expect(afterRetry[0].error).toContain('no video slots left');
  });

  it('turns a now-disallowed video into a permanent failure', () => {
    const failed = [
      item({ file: file('clip.mp4', 'video/mp4', 1_000), status: 'error', error: 'Network error' }),
    ];
    const afterRetry = resetForRetry(failed, { allowVideo: false, videosRemaining: null });
    expect(afterRetry[0].status).toBe('error');
    expect(afterRetry[0].permanent).toBe(true);
  });

  it('counts only the failures a retry could fix', () => {
    const queue = [
      item({ status: 'error', permanent: true, error: 'too big' }),
      item({ status: 'error', error: 'network' }),
      item({ status: 'done' }),
    ];
    // The button hides entirely when this is zero, so a guest is never offered
    // a retry that cannot work.
    expect(retryableCount(queue)).toBe(1);
    expect(retryableCount([item({ status: 'error', permanent: true })])).toBe(0);
  });
});
