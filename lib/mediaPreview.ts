const PREVIEW_MAX_DIMENSION = 1280;
const PREVIEW_JPEG_QUALITY = 0.68;

// The "small" low-resolution image guests see once the upload window closes.
const THUMB_MAX_DIMENSION = 480;
const THUMB_JPEG_QUALITY = 0.5;

/**
 * Resize an image file to a JPEG blob at most `maxDimension` on its longest side.
 * Returns null for videos or formats the current browser cannot decode.
 */
async function resizeImage(
  file: File,
  maxDimension: number,
  quality: number,
): Promise<Blob | null> {
  if (!file.type.toLowerCase().startsWith('image/')) return null;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This browser could not create a preview.'));
      element.src = objectUrl;
    });

    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Screen-friendly preview (the "larger" view guests see while an event is open). */
export async function createPhotoPreview(file: File): Promise<Blob | null> {
  return resizeImage(file, PREVIEW_MAX_DIMENSION, PREVIEW_JPEG_QUALITY);
}

/** Small low-res thumbnail (what guests see during the post-window low-res phase). */
export async function createPhotoThumb(file: File): Promise<Blob | null> {
  return resizeImage(file, THUMB_MAX_DIMENSION, THUMB_JPEG_QUALITY);
}
