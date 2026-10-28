/**
 * Booth photo session helpers (docs/booth-mode.md, "Take photos in the app").
 * Pure and browser-independent where possible, so they can be tested.
 *
 * A guest opens their own booth code with their phone camera, SharePix opens
 * a live camera, and every shot is shrunk on the phone and uploaded to that
 * guest in the background until they tap Stop.
 */

/** Longest edge after shrinking on the phone; also drops location data. */
export const GUEST_LONG_EDGE = 2000;
/** Upload size ceiling (decoded bytes); the server refuses above 700 KB. */
const TARGET_BYTES = 680 * 1024;

/** Photos kept in memory waiting to send. Past this the shutter waits. */
export const MAX_BACKLOG = 30;

/** Scale for a frame so its longest edge is at most GUEST_LONG_EDGE. */
export function captureSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > 0 ? Math.min(1, GUEST_LONG_EDGE / longest) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Canvas to a JPEG data URL under the server's size limit (a canvas carries no EXIF). */
export function canvasToJpeg(canvas: { toDataURL: (type: string, quality?: number) => string }): string {
  for (const q of [0.85, 0.75, 0.6, 0.5]) {
    const data = canvas.toDataURL('image/jpeg', q);
    if (data.length * 0.75 < TARGET_BYTES) return data;
  }
  return canvas.toDataURL('image/jpeg', 0.4);
}

export interface CaptureState {
  /** Uploaded and accepted. */
  sent: number;
  /** Taken and waiting (including the one sending now). */
  waiting: number;
  /** Could not be sent (no connection); kept so they can be retried. */
  failed: number;
  /** The server said no more photos (closed, limit); null while fine. */
  stopped: string | null;
}

type Send = (image: string) => Promise<{ ok: boolean; message: string }>;

/**
 * Sequential background uploads. A shot never waits for the one before it.
 * - A refusal from the server (uploads closed, limit) stops the queue and
 *   keeps the rest, with the server's words in `stopped`.
 * - A network error is retried a few times with a pause, then the photo is
 *   kept as `failed` until retryFailed() is called.
 */
export function createUploadQueue(opts: {
  send: Send;
  onChange?: (s: CaptureState) => void;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waiting: string[] = [];
  let failed: string[] = [];
  let sent = 0;
  let stopped: string | null = null;
  let running: Promise<void> | null = null;
  let inFlight = 0;

  const state = (): CaptureState => ({ sent, waiting: waiting.length + inFlight, failed: failed.length, stopped });
  const emit = () => opts.onChange?.(state());

  async function run() {
    while (waiting.length > 0 && !stopped) {
      const image = waiting.shift() as string;
      inFlight = 1;
      emit();
      let done = false;
      let lastNetworkError = false;
      for (let attempt = 0; attempt <= retries && !done; attempt += 1) {
        try {
          const res = await opts.send(image);
          lastNetworkError = false;
          if (res.ok) {
            sent += 1;
          } else {
            stopped = res.message || 'Photos can not be added right now.';
            failed.push(image);
          }
          done = true;
        } catch {
          lastNetworkError = true;
          if (attempt < retries) await sleep(1000 * (attempt + 1));
        }
      }
      inFlight = 0;
      if (!done && lastNetworkError) {
        // No connection: keep this and everything behind it for a retry.
        failed.push(image, ...waiting);
        waiting = [];
      }
      if (stopped) {
        failed.push(...waiting);
        waiting = [];
      }
      emit();
    }
  }

  function kick() {
    if (!running) {
      running = run().finally(() => {
        running = null;
        emit();
      });
    }
  }

  return {
    state,
    /** Whether the shutter may take another: false once stopped or the backlog is full. */
    canAdd: () => !stopped && waiting.length + failed.length + inFlight < MAX_BACKLOG,
    add(image: string): boolean {
      if (stopped || waiting.length + failed.length + inFlight >= MAX_BACKLOG) return false;
      waiting.push(image);
      emit();
      kick();
      return true;
    },
    retryFailed() {
      if (stopped) return;
      waiting.push(...failed);
      failed = [];
      emit();
      kick();
    },
    /** Resolves once nothing is sending (waiting photos have been tried). */
    async idle(): Promise<void> {
      while (running) await running;
    },
  };
}

/** The guest's private photo page, as an absolute link for a QR code. */
export function personalPageUrl(origin: string, galleryKey: string): string {
  return `${origin.replace(/\/$/, '')}/booth/photos/${encodeURIComponent(galleryKey)}`;
}
