import { useState } from 'react';
import Notice from '@/components/Notice';
import { uploadBoothGuestPhoto } from '@/lib/api';
import { GUEST_LONG_EDGE, canvasToJpeg } from '@/lib/boothCapture';

export { GUEST_LONG_EDGE };

/** Shrink a picked photo to a JPEG data URL (the canvas carries no EXIF). */
export async function shrinkToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file could not be used. Try a JPEG photo.'));
      i.src = url;
    });
    const scale = Math.min(1, GUEST_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    return canvasToJpeg(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A scanned guest adding their own photos from their photo page, until the
 * host closes uploads or the stop code is scanned. Each waits for approval.
 */
export default function BoothGuestUpload({
  galleryKey,
  open,
  message,
  left,
}: {
  galleryKey: string;
  open: boolean;
  message: string | null;
  left: number;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [closed, setClosed] = useState<string | null>(open ? null : message);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    let sent = 0;
    for (const [i, f] of [...files].entries()) {
      setBusy(`Sending ${i + 1} of ${files.length}…`);
      try {
        const result = await uploadBoothGuestPhoto(galleryKey, await shrinkToJpeg(f));
        if (!result.ok) {
          setNote({ ok: false, text: result.message });
          if (/closed|most photos/i.test(result.message)) setClosed(result.message);
          break;
        }
        sent += 1;
      } catch (err) {
        setNote({ ok: false, text: err instanceof Error ? err.message : 'That photo did not upload.' });
        break;
      }
    }
    setBusy(null);
    if (sent > 0) {
      setNote({
        ok: true,
        text: `Thanks! ${sent} photo${sent === 1 ? '' : 's'} sent to the host. They show here once approved.`,
      });
    }
  }

  if (closed) {
    return <p className="mt-4 text-sm text-charcoal/75">{closed}</p>;
  }
  return (
    <div className="mt-4 border border-charcoal/15 p-4">
      <p className="text-base font-semibold">Add your own photos</p>
      <p className="mt-1 text-sm text-charcoal/75">
        Share photos from your phone. The host checks each one before it appears here. You can add {left} more.
      </p>
      <label className="spx-btn-ink mt-3 inline-flex min-h-[48px] cursor-pointer items-center px-5">
        {busy ?? 'Choose photos'}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy !== null}
          className="sr-only"
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {note ? (
        <Notice tone={note.ok ? 'success' : 'error'} className="mt-3">
          {note.text}
        </Notice>
      ) : null}
    </div>
  );
}
