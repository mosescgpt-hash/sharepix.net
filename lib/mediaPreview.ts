const PREVIEW_MAX_DIMENSION = 1280;
const PREVIEW_JPEG_QUALITY = 0.68;

/**
 * Creates a screen-friendly photo preview in the browser.
 * Returns null for videos or image formats the current browser cannot decode.
 */
export async function createPhotoPreview(file: File): Promise<Blob | null> {
  if (!file.type.toLowerCase().startsWith('image/')) return null;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This browser could not create a preview.'));
      element.src = objectUrl;
    });

    const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', PREVIEW_JPEG_QUALITY);
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
