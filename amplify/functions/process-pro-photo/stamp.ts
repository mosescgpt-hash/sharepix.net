/**
 * Burn a photographer's watermark into a preview (text, logo, or both) at the
 * position and opacity they chose. Shared, identically, by process-pro-photo
 * and restamp-pro-photos; a test checks the copies.
 */
import { BlendMode, Jimp, loadFont, measureText, measureTextHeight } from 'jimp';
import { LOGO_WIDTH_SHARE, placement, type WatermarkSpec } from './watermark';

type Image = Awaited<ReturnType<typeof Jimp.read>>;

async function fontFor(width: number) {
  const { SANS_16_WHITE, SANS_32_WHITE, SANS_64_WHITE } = await import('jimp/fonts');
  return loadFont(width >= 1500 ? SANS_64_WHITE : width >= 900 ? SANS_32_WHITE : SANS_16_WHITE);
}

export async function applyWatermark(image: Image, spec: WatermarkSpec): Promise<void> {
  const marks: Image[] = [];

  if (spec.logo) {
    try {
      const logo = await Jimp.read(Buffer.from(spec.logo.split(',')[1] ?? '', 'base64'));
      const width = Math.max(24, Math.round(image.width * LOGO_WIDTH_SHARE));
      if (logo.width > width) logo.resize({ w: width });
      marks.push(logo as Image);
    } catch {
      // An unreadable logo stamps the text alone rather than failing the photo.
    }
  }

  if (spec.text) {
    const font = await fontFor(image.width);
    const width = Math.min(image.width, measureText(font, spec.text) + 4);
    const height = measureTextHeight(font, spec.text, width + 10) + 4;
    const layer = new Jimp({ width, height, color: 0x00000000 });
    layer.print({ font, x: 2, y: 2, text: spec.text });
    marks.push(layer as unknown as Image);
  }

  if (marks.length === 0) return;

  // Logo above text, aligned to the same side as the position.
  const gap = Math.round(image.width * 0.01);
  const blockWidth = Math.max(...marks.map((m) => m.width));
  const blockHeight = marks.reduce((sum, m) => sum + m.height, 0) + gap * (marks.length - 1);
  const block = new Jimp({ width: blockWidth, height: blockHeight, color: 0x00000000 });
  const alignRight = spec.position.endsWith('right');
  const center = spec.position === 'center';
  let y = 0;
  for (const mark of marks) {
    const x = center ? Math.round((blockWidth - mark.width) / 2) : alignRight ? blockWidth - mark.width : 0;
    block.composite(mark, x, y);
    y += mark.height + gap;
  }

  const at = placement(image.width, image.height, blockWidth, blockHeight, spec.position);
  image.composite(block, at.x, at.y, { mode: BlendMode.SRC_OVER, opacitySource: spec.opacity });
}
