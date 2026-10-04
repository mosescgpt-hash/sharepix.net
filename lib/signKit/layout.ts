/**
 * Where everything goes on a sign, as a flat list of drawing primitives in
 * inches. Pure: the renderer (render.ts) only draws what this returns, so the
 * rules that matter on paper — QR size, quiet zone, nothing outside the safe
 * area — are testable without a PDF or a browser.
 *
 * Portrait pieces are one centred column, scaled from a 5 × 7 reference. The
 * QR takes whatever height the text leaves, capped so it never runs edge to
 * edge. The small card is landscape: QR on the left, text on the right.
 */
import {
  ACCENT_DOTS,
  CROP_SLUG,
  QUIET_ZONE_MODULES,
  SIGN_COLORS,
  type SignPiece,
  type SignVariant,
} from './pieces';
import { qrMatrix, type QrMatrix } from './qr';
import { fitText, type Measure } from './text';

/** Points to inches. */
export const PT = 1 / 72;
/** Line height as a multiple of font size. */
const LEADING = 1.2;

export type SignElement =
  | { type: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | {
      type: 'roundedRect';
      x: number;
      y: number;
      w: number;
      h: number;
      r: number;
      fill: string | null;
      stroke: string | null;
      strokeWidth: number;
    }
  | {
      type: 'text';
      text: string;
      /** Anchor: centre of the line for 'center', left edge for 'left'. */
      x: number;
      /** Top of the line box. */
      y: number;
      sizePt: number;
      bold: boolean;
      color: string;
      align: 'center' | 'left';
      charSpace: number;
    }
  | { type: 'circle'; x: number; y: number; r: number; fill: string }
  | {
      type: 'qr';
      x: number;
      y: number;
      /** Width of the symbol itself, quiet zone excluded. */
      size: number;
      matrix: QrMatrix;
      color: string;
    }
  | { type: 'logo'; x: number; y: number; height: number; body: string; detail: string; play: string }
  | { type: 'nfcIcon'; x: number; y: number; size: number; color: string; strokeWidth: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; widthPt: number };

export interface SignContent {
  eventName: string;
  /** The line under the name: "Scan to share your photos". */
  instruction: string;
  /** What the QR encodes — the same link the NFC page copies. */
  uploadUrl: string;
  /** e.g. "sharepix.net/join" — printed, not encoded. */
  joinUrl: string;
  /** The event code a guest types at joinUrl. */
  eventCode: string;
  /** Thank-you insert only: "Uploads stay open until June 5, 2026". */
  closesLine: string | null;
}

export interface SignLayout {
  pageWidth: number;
  pageHeight: number;
  /** The finished sign inside the page. Equals the page unless there is bleed. */
  trim: { x: number; y: number; w: number; h: number };
  /** Inside this, nothing is at risk of being trimmed. */
  safe: { x: number; y: number; w: number; h: number };
  qr: { x: number; y: number; size: number; modules: number; field: number };
  elements: SignElement[];
}

export const NO_APP_LINE = 'No app needed';
export const TAGLINE = 'Capture. Connect. Celebrate.';
export const THANKS_HEADLINE = 'Thank you for celebrating with us';

/** The logo's viewBox is 40 × 34. */
export const LOGO_ASPECT = 40 / 34;

export function fallbackLine(content: SignContent): string {
  return `No camera? Go to ${content.joinUrl} and enter ${content.eventCode}`;
}

export function layoutSign(
  piece: SignPiece,
  variant: SignVariant,
  content: SignContent,
  measure: Measure,
): SignLayout {
  const matrix = qrMatrix(content.uploadUrl);
  const slug = piece.bleed > 0 ? CROP_SLUG : 0;
  const trim = { x: slug, y: slug, w: piece.width, h: piece.height };
  const elements: SignElement[] = [];

  elements.push({
    type: 'rect',
    x: trim.x - piece.bleed,
    y: trim.y - piece.bleed,
    w: trim.w + 2 * piece.bleed,
    h: trim.h + 2 * piece.bleed,
    fill: variant.background,
  });

  const body =
    piece.kind === 'card'
      ? layoutCard(piece, variant, content, measure, matrix, trim)
      : layoutPortrait(piece, variant, content, measure, matrix, trim);
  elements.push(...body.elements);
  if (piece.bleed > 0) elements.push(...cropMarks(trim, piece.bleed));

  return {
    pageWidth: trim.w + 2 * slug,
    pageHeight: trim.h + 2 * slug,
    trim,
    safe: body.safe,
    qr: body.qr,
    elements,
  };
}

interface Body {
  elements: SignElement[];
  safe: SignLayout['safe'];
  qr: SignLayout['qr'];
}

/** A block of centred lines, stacked downward. */
interface Row {
  height: number;
  draw: (top: number) => SignElement[];
}

function textRow(
  lines: string[],
  sizePt: number,
  bold: boolean,
  color: string,
  centerX: number,
  charSpace = 0,
): Row {
  const lineH = sizePt * LEADING * PT;
  return {
    height: lines.length * lineH,
    draw: (top) =>
      lines.map((text, i) => ({
        type: 'text' as const,
        text,
        x: centerX,
        y: top + i * lineH,
        sizePt,
        bold,
        color,
        align: 'center' as const,
        charSpace,
      })),
  };
}

function qrPanel(
  variant: SignVariant,
  matrix: QrMatrix,
  x: number,
  y: number,
  field: number,
): { elements: SignElement[]; qr: SignLayout['qr'] } {
  const modules = matrix.length;
  const moduleSize = field / (modules + 2 * QUIET_ZONE_MODULES);
  const quiet = QUIET_ZONE_MODULES * moduleSize;
  const size = modules * moduleSize;
  return {
    elements: [
      {
        type: 'roundedRect',
        x,
        y,
        w: field,
        h: field,
        // Rounding stays well inside the quiet zone, clear of the finder patterns.
        r: moduleSize * 1.5,
        fill: variant.qrField,
        stroke: variant.qrBorder,
        strokeWidth: Math.max(0.005, field * 0.004),
      },
      { type: 'qr', x: x + quiet, y: y + quiet, size, matrix, color: variant.qrModules },
    ],
    qr: { x: x + quiet, y: y + quiet, size, modules, field },
  };
}

/** Logo + "SharePix" + tagline on one centred line. */
function footerRow(variant: SignVariant, measure: Measure, centerX: number, s: number): Row {
  const brandPt = 9 * s;
  const tagPt = 7.5 * s;
  const logoH = brandPt * 1.15 * PT;
  const logoW = logoH * LOGO_ASPECT;
  const gap = 0.06 * s;
  const brand = 'SharePix';
  const tag = TAGLINE;
  const brandW = measure(brand, brandPt, true);
  const tagW = measure(tag, tagPt, false);
  const total = logoW + gap + brandW + gap * 1.5 + tagW;
  const height = logoH;
  return {
    height,
    draw: (top) => {
      let x = centerX - total / 2;
      const out: SignElement[] = [
        {
          type: 'logo',
          x,
          y: top,
          height: logoH,
          body: variant.logoBody,
          detail: variant.logoDetail,
          play: SIGN_COLORS.green,
        },
      ];
      x += logoW + gap;
      const textTop = top + (logoH - brandPt * PT) / 2;
      out.push({
        type: 'text',
        text: brand,
        x,
        y: textTop,
        sizePt: brandPt,
        bold: true,
        color: variant.text,
        align: 'left',
        charSpace: 0,
      });
      x += brandW + gap * 1.5;
      out.push({
        type: 'text',
        text: tag,
        x,
        y: textTop + (brandPt - tagPt) * PT * 0.6,
        sizePt: tagPt,
        bold: false,
        color: variant.text,
        align: 'left',
        charSpace: 0,
      });
      return out;
    },
  };
}

function accentRow(centerX: number, s: number): Row {
  const r = 0.035 * s;
  const spacing = 0.13 * s;
  return {
    height: 2 * r,
    draw: (top) =>
      ACCENT_DOTS.map((fill, i) => ({
        type: 'circle' as const,
        x: centerX + (i - (ACCENT_DOTS.length - 1) / 2) * spacing,
        y: top + r,
        r,
        fill,
      })),
  };
}

/** A pill with the contactless symbol and "or tap here". */
function nfcRow(variant: SignVariant, measure: Measure, centerX: number, s: number): Row {
  const labelPt = 10 * s;
  const label = 'or tap here';
  const height = 0.3 * s;
  const icon = height * 0.62;
  const pad = height * 0.45;
  const gap = height * 0.25;
  const labelW = measure(label, labelPt, true);
  const width = pad + icon + gap + labelW + pad;
  return {
    height,
    draw: (top) => {
      const left = centerX - width / 2;
      return [
        {
          type: 'roundedRect',
          x: left,
          y: top,
          w: width,
          h: height,
          r: height / 2,
          fill: null,
          stroke: variant.emphasis,
          strokeWidth: 0.012 * s,
        },
        {
          type: 'nfcIcon',
          x: left + pad,
          y: top + (height - icon) / 2,
          size: icon,
          color: variant.emphasis,
          strokeWidth: 0.014 * s,
        },
        {
          type: 'text',
          text: label,
          x: left + pad + icon + gap,
          y: top + (height - labelPt * PT) / 2,
          sizePt: labelPt,
          bold: true,
          color: variant.emphasis,
          align: 'left',
          charSpace: 0,
        },
      ];
    },
  };
}

function layoutPortrait(
  piece: SignPiece,
  variant: SignVariant,
  content: SignContent,
  measure: Measure,
  matrix: QrMatrix,
  trim: SignLayout['trim'],
): Body {
  // Scale relative to a 5 × 7 sign, by whichever dimension binds.
  const s = Math.min(trim.w, (trim.h * 5) / 7) / 5;
  const margin = Math.max(0.25, 0.36 * s);
  const safe = { x: trim.x + margin, y: trim.y + margin, w: trim.w - 2 * margin, h: trim.h - 2 * margin };
  const cx = trim.x + trim.w / 2;
  const gap = 0.13 * s;
  const qrGap = 0.17 * s;

  type Slot = Row | 'qr';
  const slots: Array<{ slot: Slot; gapAfter: number }> = [];
  const add = (slot: Slot, gapAfter = gap) => slots.push({ slot, gapAfter });

  if (piece.kicker) {
    add(textRow([piece.kicker.toUpperCase()], 11 * s, true, variant.emphasis, cx, 1.6 * s * PT), gap * 0.6);
  }
  if (piece.kind === 'thanks') {
    const head = fitText(THANKS_HEADLINE, safe.w, 2, 22 * s, 15 * s, true, measure);
    add(textRow(head.lines, head.sizePt, true, variant.text, cx), gap * 0.7);
    const name = fitText(content.eventName, safe.w, 2, 13 * s, 9 * s, false, measure);
    add(textRow(name.lines, name.sizePt, false, variant.text, cx));
  } else {
    const name = fitText(content.eventName, safe.w, 2, 26 * s, 17 * s, true, measure);
    add(textRow(name.lines, name.sizePt, true, variant.text, cx));
  }
  add(accentRow(cx, s));
  const instruction = fitText(content.instruction, safe.w, 1, 17 * s, 12 * s, true, measure);
  add(textRow(instruction.lines, instruction.sizePt, true, variant.text, cx), qrGap);
  add('qr', qrGap);
  add(textRow([NO_APP_LINE], 12.5 * s, true, variant.emphasis, cx), gap * 0.6);
  if (piece.kind === 'thanks' && content.closesLine) {
    const closes = fitText(content.closesLine, safe.w, 2, 10 * s, 8 * s, false, measure);
    add(textRow(closes.lines, closes.sizePt, false, variant.text, cx), gap * 0.6);
  }
  const fallback = fitText(fallbackLine(content), safe.w, 2, 9.5 * s, 7.5 * s, false, measure);
  add(textRow(fallback.lines, fallback.sizePt, false, variant.text, cx), piece.nfcMark ? gap : gap * 1.6);
  if (piece.nfcMark) add(nfcRow(variant, measure, cx, s), gap * 1.6);
  add(footerRow(variant, measure, cx, s), 0);

  const fixed = slots.reduce(
    (sum, { slot, gapAfter }) => sum + (slot === 'qr' ? 0 : slot.height) + gapAfter,
    0,
  );
  // The QR gets the height that is left, never wider than 70% of the sign.
  const field = Math.min(safe.h - fixed, safe.w, trim.w * 0.7);
  const spare = Math.max(0, safe.h - fixed - field);

  const elements: SignElement[] = [];
  let qr: SignLayout['qr'] | null = null;
  let y = safe.y + spare / 2;
  for (const { slot, gapAfter } of slots) {
    if (slot === 'qr') {
      const panel = qrPanel(variant, matrix, cx - field / 2, y, field);
      elements.push(...panel.elements);
      qr = panel.qr;
      y += field + gapAfter;
    } else {
      elements.push(...slot.draw(y));
      y += slot.height + gapAfter;
    }
  }
  return { elements, safe, qr: qr! };
}

function layoutCard(
  piece: SignPiece,
  variant: SignVariant,
  content: SignContent,
  measure: Measure,
  matrix: QrMatrix,
  trim: SignLayout['trim'],
): Body {
  const margin = 0.14;
  const safe = { x: trim.x + margin, y: trim.y + margin, w: trim.w - 2 * margin, h: trim.h - 2 * margin };
  const modules = matrix.length;
  const field = (piece.minQrSymbol * (modules + 2 * QUIET_ZONE_MODULES)) / modules;
  const panel = qrPanel(variant, matrix, safe.x, safe.y + (safe.h - field) / 2, field);

  const colX = safe.x + field + 0.12;
  const colW = safe.x + safe.w - colX;
  const left = (lines: string[], sizePt: number, bold: boolean, color: string): Row => {
    const lineH = sizePt * LEADING * PT;
    return {
      height: lines.length * lineH,
      draw: (top) =>
        lines.map((text, i) => ({
          type: 'text' as const,
          text,
          x: colX,
          y: top + i * lineH,
          sizePt,
          bold,
          color,
          align: 'left' as const,
          charSpace: 0,
        })),
    };
  };
  const name = fitText(content.eventName, colW, 3, 10, 7, true, measure);
  const instruction = fitText(content.instruction, colW, 2, 7.5, 6, true, measure);
  const join = fitText(`Or go to ${content.joinUrl}`, colW, 1, 6, 5, false, measure);
  const code = fitText(`Code: ${content.eventCode}`, colW, 2, 6, 5, false, measure);
  const tagline = fitText(TAGLINE, colW, 1, 5, 4.5, false, measure);

  const brandPt = 6.5;
  const logoH = brandPt * 1.15 * PT;
  const brandRow: Row = {
    height: logoH,
    draw: (top) => [
      { type: 'logo', x: colX, y: top, height: logoH, body: variant.logoBody, detail: variant.logoDetail, play: SIGN_COLORS.green },
      {
        type: 'text',
        text: 'SharePix',
        x: colX + logoH * LOGO_ASPECT + 0.04,
        y: top + (logoH - brandPt * PT) / 2,
        sizePt: brandPt,
        bold: true,
        color: variant.text,
        align: 'left',
        charSpace: 0,
      },
    ],
  };

  const rows: Array<[Row, number]> = [
    [left(name.lines, name.sizePt, true, variant.text), 0.06],
    [left(instruction.lines, instruction.sizePt, true, variant.text), 0.03],
    [left([NO_APP_LINE], 6.5, true, variant.emphasis), 0.06],
    [left(join.lines, join.sizePt, false, variant.text), 0],
    [left(code.lines, code.sizePt, false, variant.text), 0.08],
    [brandRow, 0.02],
    [left(tagline.lines, tagline.sizePt, false, variant.text), 0],
  ];
  const total = rows.reduce((sum, [row, g]) => sum + row.height + g, 0);
  const elements: SignElement[] = [...panel.elements];
  let y = safe.y + Math.max(0, (safe.h - total) / 2);
  for (const [row, g] of rows) {
    elements.push(...row.draw(y));
    y += row.height + g;
  }
  return { elements, safe, qr: panel.qr };
}

/** Corner crop marks in the slug, kept clear of the bleed. */
function cropMarks(trim: SignLayout['trim'], bleed: number): SignElement[] {
  const offset = bleed + 0.0625;
  const length = 0.25;
  const color = SIGN_COLORS.outline;
  const widthPt = 0.25;
  const out: SignElement[] = [];
  const xs = [trim.x, trim.x + trim.w];
  const ys = [trim.y, trim.y + trim.h];
  for (const x of xs) {
    for (const y of ys) {
      const dx = x === trim.x ? -1 : 1;
      const dy = y === trim.y ? -1 : 1;
      // Horizontal mark on the trim line y, out past the left/right edge.
      out.push({ type: 'line', x1: x + dx * offset, y1: y, x2: x + dx * (offset + length), y2: y, color, widthPt });
      // Vertical mark on the trim line x, out past the top/bottom edge.
      out.push({ type: 'line', x1: x, y1: y + dy * offset, x2: x, y2: y + dy * (offset + length), color, widthPt });
    }
  }
  return out;
}
