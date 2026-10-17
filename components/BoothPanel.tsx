import { useCallback, useEffect, useRef, useState } from 'react';
import Notice from '@/components/Notice';
import { scanBoothCode, setBoothClock, type BoothStatusView } from '@/lib/api';
import { tokenFromBoothQr } from '@/lib/booth';
import { cameraClockMs, exifCaptureTime } from '@/lib/captureTime';

/**
 * The photographer's booth controls on the review page (docs/booth-mode.md).
 *
 * Scan a code, then shoot: every photo taken after a scan goes to that person
 * until the next one. The match uses when the photo was taken, so the camera's
 * clock matters — hence the one-tap sync, and a time-zone guess until then.
 */
export default function BoothPanel({
  eventId,
  status,
  onChange,
}: {
  eventId: string;
  status: BoothStatusView;
  onChange: () => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);

  // Until the photographer syncs, assume the camera is set to this phone's
  // local time. The server never lets this replace a measured offset.
  const guessed = useRef(false);
  useEffect(() => {
    if (status.clockOffsetMs !== null || guessed.current) return;
    guessed.current = true;
    void setBoothClock(eventId, -new Date().getTimezoneOffset() * 60_000, false)
      .then(onChange)
      .catch(() => undefined);
  }, [eventId, status.clockOffsetMs, onChange]);

  async function handleToken(token: string) {
    setScanning(false);
    try {
      const result = await scanBoothCode(eventId, token);
      setNote({ tone: result.ok ? 'success' : 'error', text: result.message });
      if (result.ok) {
        navigator.vibrate?.(80);
        onChange();
      }
    } catch (err) {
      setNote({ tone: 'error', text: err instanceof Error ? err.message : 'That scan did not go through.' });
    }
  }

  async function handleSyncPhoto(file: File | undefined) {
    if (!file || syncStartedAt === null) return;
    const bytes = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    const text = exifCaptureTime(bytes);
    const camera = text ? cameraClockMs(text) : null;
    if (camera === null) {
      setNote({
        tone: 'error',
        text: 'That photo has no capture time. Choose a JPEG straight from the camera.',
      });
      return;
    }
    const offset = camera - syncStartedAt;
    try {
      const result = await setBoothClock(eventId, offset, true);
      setNote({ tone: result.ok ? 'success' : 'error', text: result.message });
      setSyncStartedAt(null);
      if (result.ok) onChange();
    } catch (err) {
      setNote({ tone: 'error', text: err instanceof Error ? err.message : 'The camera clock could not be saved.' });
    }
  }

  return (
    <div className="mt-6 border border-pine/40 bg-sage/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-charcoal/55">Booth mode</p>
          <p className="mt-1 truncate text-lg font-semibold">
            {status.currentName ? `Now shooting: ${status.currentName}` : 'Scan the first person’s code'}
          </p>
          {status.currentScannedAt ? (
            <p className="text-xs text-charcoal/60">
              Scanned {new Date(status.currentScannedAt).toLocaleTimeString()}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={() => setScanning(true)} className="spx-btn-ink">
          Scan next person
        </button>
      </div>

      <p className="mt-3 text-sm text-charcoal/70">
        Every photo taken after a scan goes to that person until the next scan, matched by
        when it was taken — so late uploads still land with the right person.
      </p>

      <div className="mt-3 border-t border-charcoal/10 pt-3 text-sm">
        {syncStartedAt === null ? (
          <p>
            Camera clock:{' '}
            <span className="font-medium">
              {status.clockSynced ? 'synced' : 'not synced — assuming it matches this phone'}
            </span>
            .{' '}
            <button
              type="button"
              onClick={() => {
                setNote(null);
                setSyncStartedAt(Date.now());
              }}
              className="text-pine underline"
            >
              {status.clockSynced ? 'Sync again' : 'Sync camera clock'}
            </button>
          </p>
        ) : (
          <div>
            <p className="font-medium">Take one photo with your camera now, then choose it here.</p>
            <p className="mt-1 text-xs text-charcoal/60">
              Any subject works. Take it within a few seconds of tapping sync.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept="image/jpeg"
                onChange={(e) => void handleSyncPhoto(e.target.files?.[0])}
                className="text-sm"
              />
              <button type="button" onClick={() => setSyncStartedAt(null)} className="text-sm text-charcoal/60 underline">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {note ? (
        <Notice tone={note.tone} className="mt-3">
          {note.text}
        </Notice>
      ) : null}

      {scanning ? <QrScanner onToken={(t) => void handleToken(t)} onClose={() => setScanning(false)} /> : null}
    </div>
  );
}

/**
 * The phone camera, reading QR codes until it finds a booth code.
 *
 * jsQR rather than the browser's BarcodeDetector, because iPhone Safari does
 * not have BarcodeDetector and most photographers' phones are iPhones.
 */
function QrScanner({ onToken, onClose }: { onToken: (token: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrongCode, setWrongCode] = useState(false);
  const done = useRef(false);

  const finish = useCallback(
    (token: string) => {
      if (done.current) return;
      done.current = true;
      onToken(token);
    },
    [onToken],
  );

  useEffect(() => {
    done.current = false;
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    void (async () => {
      try {
        const { default: jsQR } = await import('jsqr');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const el = video.current;
        if (!el || !context) return;
        el.srcObject = stream;
        await el.play();
        const tick = () => {
          if (done.current) return;
          if (el.videoWidth > 0) {
            // Scaled down: decoding a full 4K frame every tick would stall a phone.
            const scale = Math.min(1, 640 / el.videoWidth);
            canvas.width = Math.round(el.videoWidth * scale);
            canvas.height = Math.round(el.videoHeight * scale);
            context.drawImage(el, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
            if (found?.data) {
              const token = tokenFromBoothQr(found.data);
              if (token) {
                finish(token);
                return;
              }
              setWrongCode(true);
            }
          }
          timer = window.setTimeout(tick, 200);
        };
        tick();
      } catch {
        setError('The camera could not be opened. Allow camera access for this site and try again.');
      }
    })();

    return () => {
      done.current = true;
      if (timer !== null) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [finish]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/90 p-4" role="dialog" aria-label="Scan a booth code">
      <div className="w-full max-w-md">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <video ref={video} playsInline muted className="aspect-square w-full bg-black object-cover" />
        )}
        <p className="mt-3 text-center text-sm text-white/80">
          {wrongCode ? 'That is not a SharePix booth code. Point at the person’s booth code.' : 'Point the camera at the person’s code.'}
        </p>
        <button type="button" onClick={onClose} className="mt-4 w-full border border-white/40 px-4 py-2 text-sm font-medium text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}
