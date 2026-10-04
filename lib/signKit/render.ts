/**
 * Draws a SignLayout into a jsPDF document. Everything is vector: the QR is
 * rectangles, the logo is shapes, the text is Helvetica.
 *
 * The jsPDF constructor is passed in so the page can load it with a dynamic
 * import (it only ever ships to hosts who open the Signs page) and the tests
 * can use it directly in Node.
 */
import type { jsPDF as JsPdf } from 'jspdf';
import { layoutSign, type SignContent, type SignElement, type SignLayout } from './layout';
import { qrRuns } from './qr';
import { SIGN_VARIANTS, type SignPiece, type SignVariantKey } from './pieces';
import type { Measure } from './text';

type JsPdfConstructor = new (options: {
  unit: 'in';
  format: [number, number];
  orientation: 'portrait' | 'landscape';
  compress?: boolean;
}) => JsPdf;

export function measureWith(doc: JsPdf): Measure {
  return (text, sizePt, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(sizePt);
    return doc.getTextWidth(text);
  };
}

export function buildSignPdf(
  JsPDF: JsPdfConstructor,
  piece: SignPiece,
  variantKey: SignVariantKey,
  content: SignContent,
): { doc: JsPdf; layout: SignLayout } {
  const variant = SIGN_VARIANTS[variantKey];
  // The page size depends on the bleed, which the layout knows; measuring text
  // does not, so a scratch document measures and the real one is sized after.
  const scratch = new JsPDF({ unit: 'in', format: [8.5, 11], orientation: 'portrait' });
  const layout = layoutSign(piece, variant, content, measureWith(scratch));
  const doc = new JsPDF({
    unit: 'in',
    format: [layout.pageWidth, layout.pageHeight],
    // jsPDF swaps width and height to match the orientation, so it must agree.
    orientation: layout.pageWidth > layout.pageHeight ? 'landscape' : 'portrait',
    compress: true,
  });
  doc.setProperties({
    title: `${content.eventName} - ${piece.label}`,
    subject: 'Scan to share your photos',
    creator: 'SharePix',
  });
  for (const el of layout.elements) drawElement(doc, el);
  return { doc, layout };
}

function drawElement(doc: JsPdf, el: SignElement): void {
  switch (el.type) {
    case 'rect':
      doc.setFillColor(el.fill);
      doc.rect(el.x, el.y, el.w, el.h, 'F');
      return;
    case 'roundedRect': {
      const style = el.fill && el.stroke ? 'FD' : el.fill ? 'F' : 'S';
      if (el.fill) doc.setFillColor(el.fill);
      if (el.stroke) {
        doc.setDrawColor(el.stroke);
        doc.setLineWidth(el.strokeWidth);
      }
      doc.roundedRect(el.x, el.y, el.w, el.h, el.r, el.r, style);
      return;
    }
    case 'circle':
      doc.setFillColor(el.fill);
      doc.circle(el.x, el.y, el.r, 'F');
      return;
    case 'text':
      doc.setFont('helvetica', el.bold ? 'bold' : 'normal');
      doc.setFontSize(el.sizePt);
      doc.setTextColor(el.color);
      doc.text(el.text, el.x, el.y, { align: el.align, baseline: 'top', charSpace: el.charSpace });
      return;
    case 'qr': {
      const m = el.size / el.matrix.length;
      doc.setFillColor(el.color);
      for (const run of qrRuns(el.matrix)) {
        doc.rect(el.x + run.col * m, el.y + run.row * m, run.length * m, m, 'F');
      }
      return;
    }
    case 'line':
      doc.setDrawColor(el.color);
      doc.setLineWidth(el.widthPt / 72);
      doc.line(el.x1, el.y1, el.x2, el.y2);
      return;
    case 'logo':
      drawLogo(doc, el);
      return;
    case 'nfcIcon':
      drawNfcIcon(doc, el);
      return;
  }
}

/** components/Logo.tsx, redrawn in PDF shapes. Its viewBox is 40 × 34. */
function drawLogo(doc: JsPdf, el: Extract<SignElement, { type: 'logo' }>): void {
  const u = el.height / 34;
  const X = (v: number) => el.x + v * u;
  const Y = (v: number) => el.y + v * u;
  doc.setFillColor(el.body);
  doc.roundedRect(X(12), Y(1), 12 * u, 7 * u, 2.5 * u, 2.5 * u, 'F');
  doc.roundedRect(X(1), Y(5), 38 * u, 28 * u, 7 * u, 7 * u, 'F');
  doc.setFillColor(el.detail);
  doc.roundedRect(X(6), Y(11), 12 * u, 12 * u, 2 * u, 2 * u, 'F');
  doc.setFillColor(el.body);
  doc.rect(X(8), Y(13), 3.2 * u, 3.2 * u, 'F');
  doc.rect(X(13), Y(13), 2.2 * u, 2.2 * u, 'F');
  doc.rect(X(8), Y(18), 2.2 * u, 2.2 * u, 'F');
  doc.rect(X(12), Y(17), 3.2 * u, 3.2 * u, 'F');
  doc.setDrawColor(el.detail);
  doc.setLineWidth(2.4 * u);
  doc.circle(X(28), Y(19), 8 * u, 'S');
  doc.setFillColor(el.play);
  doc.triangle(X(26), Y(15.5), X(32), Y(19), X(26), Y(22.5), 'F');
}

/** The contactless symbol: a dot and three arcs opening to the right. */
function drawNfcIcon(doc: JsPdf, el: Extract<SignElement, { type: 'nfcIcon' }>): void {
  const cy = el.y + el.size / 2;
  const cx = el.x + el.size * 0.12;
  doc.setFillColor(el.color);
  doc.circle(cx, cy, el.size * 0.09, 'F');
  doc.setDrawColor(el.color);
  doc.setLineWidth(el.strokeWidth);
  doc.setLineCap('round');
  for (const radius of [0.32, 0.56, 0.8].map((f) => f * el.size)) {
    const steps = 14;
    const sweep = Math.PI / 2.4;
    const segments: number[][] = [];
    let px = cx + radius * Math.cos(-sweep);
    let py = cy + radius * Math.sin(-sweep);
    const startX = px;
    const startY = py;
    for (let i = 1; i <= steps; i += 1) {
      const a = -sweep + (2 * sweep * i) / steps;
      const nx = cx + radius * Math.cos(a);
      const ny = cy + radius * Math.sin(a);
      segments.push([nx - px, ny - py]);
      px = nx;
      py = ny;
    }
    doc.lines(segments, startX, startY, [1, 1], 'S', false);
  }
  doc.setLineCap('butt');
}
