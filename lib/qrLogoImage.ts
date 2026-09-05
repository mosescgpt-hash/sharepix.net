import { MAX_QR_LOGO_CHARS, QR_LOGO_MIME_TYPES } from '@/lib/qrBranding';

/**
 * Turn a host's logo file into something we can store on the event row.
 *
 * The centre image of a QR renders at ~24% of the code, so even on a 640px
 * printed tent that is about 154 device pixels. Downscaling to 256px is
 * therefore lossless in practice and takes a 3 MB photo to tens of kilobytes —
 * which is what lets the logo live on the event row and travel to every
 * consumer without S3, signed URLs, or a second upload pipeline.
 *
 * PNG is kept as PNG so a logo with a transparent background stays transparent;
 * anything else becomes WebP, which is smaller than JPEG at this size and is
 * supported everywhere the app already runs.
 */

export const QR_LOGO_MAX_DIMENSION = 256;
const MAX_SOURCE_BYTES = 3 * 1024 * 1024;

export type QrLogoResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('undecodable'));
    image.src = src;
  });
}

export async function prepareQrLogo(file: File): Promise<QrLogoResult> {
  if (!(QR_LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: 'Use a JPG, PNG, or WebP image.' };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return { ok: false, reason: 'Choose an image smaller than 3 MB.' };
  }

  let source: string;
  try {
    source = await readAsDataUrl(file);
  } catch {
    return { ok: false, reason: 'That image could not be read. Please try another one.' };
  }

  let image: HTMLImageElement;
  try {
    image = await loadImage(source);
  } catch {
    return { ok: false, reason: 'That image could not be read. Please try another one.' };
  }

  const longest = Math.max(image.naturalWidth, image.naturalHeight) || 1;
  const scale = Math.min(1, QR_LOGO_MAX_DIMENSION / longest);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return { ok: false, reason: 'That image could not be processed in this browser.' };
  }
  context.drawImage(image, 0, 0, width, height);

  // PNG keeps transparency, which most logos rely on. Everything else is
  // smaller as WebP at this size.
  const keepPng = file.type === 'image/png';
  const dataUrl = keepPng
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/webp', 0.85);

  if (dataUrl.length > MAX_QR_LOGO_CHARS) {
    // Almost always a detailed PNG photograph rather than a logo. Re-encoding
    // as WebP is the one retry worth making before giving up.
    const fallback = canvas.toDataURL('image/webp', 0.8);
    if (fallback.length <= MAX_QR_LOGO_CHARS) return { ok: true, dataUrl: fallback };
    return {
      ok: false,
      reason: 'That image is too detailed to sit inside a QR code. Try a simpler logo.',
    };
  }

  return { ok: true, dataUrl };
}
