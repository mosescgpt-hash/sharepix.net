import { jsPDF } from 'jspdf';
import {
  MIN_QR_SYMBOL,
  MIN_QR_SYMBOL_CARD,
  QUIET_ZONE_MODULES,
  SIGN_COLORS,
  SIGN_PIECES,
  SIGN_VARIANTS,
  pieceSizeLabel,
  signFilename,
  signKitZipName,
  signPiece,
} from '../lib/signKit/pieces';
import { PT, fallbackLine, layoutSign, type SignContent } from '../lib/signKit/layout';
import { qrMatrix, qrRuns } from '../lib/signKit/qr';
import { buildSignPdf, measureWith } from '../lib/signKit/render';
import { fitText, pdfSafeText } from '../lib/signKit/text';
import { closesLine, eventUploadUrl, signContent } from '../lib/signKit/content';
import { NFC_STORE_AFFILIATE, NFC_STORE_LINKS } from '../lib/signKit/nfcStore';

const content: SignContent = {
  eventName: 'Anderson & Okafor Wedding',
  instruction: 'Scan to share your photos',
  uploadUrl: 'https://sharepix.net/event/3f2a9c1e-7b4d-4e8a-9f12-5c6d7e8f9a0b/upload',
  joinUrl: 'sharepix.net/join',
  eventCode: 'maple-otter-lantern',
  closesLine: 'Uploads stay open until December 2, 2026',
};

const measure = measureWith(new jsPDF({ unit: 'in', format: [8.5, 11], orientation: 'portrait' }));
const variants = Object.values(SIGN_VARIANTS);
const EPS = 1e-6;

describe('sign catalogue', () => {
  it('has every size the spec lists', () => {
    expect(SIGN_PIECES.map((p) => `${p.label} ${pieceSizeLabel(p)}`)).toEqual([
      'Table tent 4 × 6 in',
      'Table tent 5 × 7 in',
      'Welcome sign 8 × 10 in',
      'Welcome sign 18 × 24 in',
      'Bar or photo-spot sign 5 × 7 in',
      'Small card 2 × 3.5 in',
      'Thank-you insert 4 × 6 in',
    ]);
  });

  it('puts the NFC mark on the table tents and welcome signs only', () => {
    expect(SIGN_PIECES.filter((p) => p.nfcMark).map((p) => p.key)).toEqual([
      'table-tent-4x6',
      'table-tent-5x7',
      'welcome-8x10',
      'welcome-18x24',
    ]);
  });

  it('gives bleed to the 18 × 24 only', () => {
    expect(SIGN_PIECES.filter((p) => p.bleed > 0).map((p) => p.key)).toEqual(['welcome-18x24']);
    expect(signPiece('welcome-18x24')?.bleed).toBe(0.125);
  });

  it('keeps the QR dark-on-light in both variants', () => {
    for (const v of variants) {
      expect(v.qrModules).toBe(SIGN_COLORS.outline);
      expect(v.qrField).toBe(SIGN_COLORS.cream);
    }
    expect(SIGN_VARIANTS.light.background).toBe(SIGN_COLORS.cream);
    expect(SIGN_VARIANTS.dark.background).toBe(SIGN_COLORS.navy);
  });

  it('names files after the event, piece and variant', () => {
    expect(signFilename('Anderson & Okafor Wedding!', SIGN_PIECES[1], 'dark')).toBe(
      'sharepix-anderson-okafor-wedding-table-tent-5x7-dark.pdf',
    );
    expect(signFilename('🎉', SIGN_PIECES[0], 'light')).toBe('sharepix-event-table-tent-4x6-light.pdf');
    expect(signKitZipName('Zoë & Sam')).toBe('sharepix-zoe-sam-signs.zip');
  });
});

describe('QR matrix', () => {
  it('encodes at level Q and rebuilds exactly from its runs', () => {
    const matrix = qrMatrix(content.uploadUrl);
    const rebuilt = matrix.map((row) => row.map(() => false));
    for (const run of qrRuns(matrix)) {
      for (let c = run.col; c < run.col + run.length; c += 1) rebuilt[run.row][c] = true;
    }
    expect(rebuilt).toEqual(matrix);
    // 70 bytes at Q is version 6: 41 modules. At M it would be version 5.
    expect(matrix.length).toBe(41);
  });
});

describe.each(SIGN_PIECES.map((p) => [p.key, p] as const))('%s', (_key, piece) => {
  it.each(variants.map((v) => [v.key, v] as const))('%s variant lays out within the sign', (_v, variant) => {
    const layout = layoutSign(piece, variant, content, measure);

    // Printed size, plus a slug for crop marks only when there is bleed.
    const slug = piece.bleed > 0 ? 0.5 : 0;
    expect(layout.pageWidth).toBeCloseTo(piece.width + 2 * slug);
    expect(layout.pageHeight).toBeCloseTo(piece.height + 2 * slug);

    // QR at least the minimum, with a four-module quiet zone.
    const min = piece.kind === 'card' ? MIN_QR_SYMBOL_CARD : MIN_QR_SYMBOL;
    expect(layout.qr.size).toBeGreaterThanOrEqual(min - EPS);
    const moduleSize = layout.qr.size / layout.qr.modules;
    expect(layout.qr.field - layout.qr.size).toBeCloseTo(2 * QUIET_ZONE_MODULES * moduleSize);

    // Every piece of text sits inside the safe area.
    const { safe } = layout;
    for (const el of layout.elements) {
      if (el.type !== 'text') continue;
      const w = measure(el.text, el.sizePt, el.bold);
      const left = el.align === 'center' ? el.x - w / 2 : el.x;
      expect(left).toBeGreaterThanOrEqual(safe.x - EPS);
      expect(left + w).toBeLessThanOrEqual(safe.x + safe.w + EPS);
      expect(el.y).toBeGreaterThanOrEqual(safe.y - EPS);
      expect(el.y + el.sizePt * PT).toBeLessThanOrEqual(safe.y + safe.h + EPS);
    }
    // And the QR field.
    expect(layout.qr.y - (layout.qr.field - layout.qr.size) / 2).toBeGreaterThanOrEqual(safe.y - EPS);

    const texts = layout.elements.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text);
    expect(texts.join(' ')).toContain('No app needed');
    expect(texts.join(' ')).toContain('Capture. Connect. Celebrate.');
    expect(texts.join(' ')).toContain('sharepix.net/join');
    expect(layout.elements.some((e) => e.type === 'nfcIcon')).toBe(piece.nfcMark);
    expect(layout.elements.filter((e) => e.type === 'line').length).toBe(piece.bleed > 0 ? 8 : 0);
  });
});

describe('sizes that matter on paper', () => {
  it('gives the 5 × 7 table tent a QR big enough to scan across a table', () => {
    const layout = layoutSign(signPiece('table-tent-5x7')!, SIGN_VARIANTS.light, content, measure);
    expect(layout.qr.size).toBeGreaterThan(2.6);
  });

  it('keeps the QR at least 2 in even with a very long event name', () => {
    const long = { ...content, eventName: 'The Very Long Annual Celebration of Everything Wonderful '.repeat(3) };
    for (const piece of SIGN_PIECES) {
      const layout = layoutSign(piece, SIGN_VARIANTS.dark, long, measure);
      expect(layout.qr.size).toBeGreaterThanOrEqual(piece.minQrSymbol - EPS);
    }
  });
});

describe('text', () => {
  it('drops characters Helvetica cannot print and keeps accented letters', () => {
    expect(pdfSafeText('Zoë’s 30th 🎉 生日')).toBe("Zoë's 30th");
    expect(pdfSafeText('  a\n\nb  ')).toBe('a b');
  });

  it('cuts a name that will not fit with an ellipsis', () => {
    const fit = fitText('word '.repeat(80).trim(), 3, 2, 30, 18, true, measure);
    expect(fit.lines).toHaveLength(2);
    expect(fit.lines[1].endsWith('…')).toBe(true);
  });

  it('points the fallback at the join page and the code', () => {
    expect(fallbackLine(content)).toBe('No camera? Go to sharepix.net/join and enter maple-otter-lantern');
  });
});

describe('buildSignPdf', () => {
  it('produces a PDF at the printed size', () => {
    for (const piece of SIGN_PIECES) {
      const { doc, layout } = buildSignPdf(jsPDF, piece, 'light', content);
      expect(doc.internal.pageSize.getWidth()).toBeCloseTo(layout.pageWidth);
      expect(doc.internal.pageSize.getHeight()).toBeCloseTo(layout.pageHeight);
      expect(doc.output().startsWith('%PDF-')).toBe(true);
    }
  });
});

describe('signContent', () => {
  const event = {
    id: 'abc-123',
    name: 'Zoë’s 30th 🎉',
    eventCode: 'maple-otter-lantern',
    uploadAudience: null,
    uploadWindowEndsAt: '2026-12-02T18:00:00.000Z',
    uploadsClosed: false,
  };
  const now = Date.parse('2026-10-03T12:00:00Z');

  it('encodes the same upload link the table tent and NFC page use', () => {
    const c = signContent(event, 'https://sharepix.net', 'www.sharepix.net', now);
    expect(c.uploadUrl).toBe('https://sharepix.net/event/abc-123/upload');
    expect(c.uploadUrl).toBe(eventUploadUrl('https://sharepix.net/', 'abc-123'));
    expect(c.joinUrl).toBe('sharepix.net/join');
    expect(c.eventName).toBe("Zoë's 30th");
    expect(c.instruction).toBe('Scan to share your photos');
    expect(c.closesLine).toBe('Uploads stay open until December 2, 2026');
  });

  it('uses the view wording when the host said only they would upload', () => {
    const c = signContent({ ...event, uploadAudience: 'host-only' }, 'https://sharepix.net', 'sharepix.net', now);
    expect(c.instruction).toBe('Scan to see the photos');
  });

  it('gives no closing date once uploads have closed', () => {
    expect(closesLine({ ...event, uploadsClosed: true }, now)).toBeNull();
    expect(closesLine(event, Date.parse('2027-01-01T00:00:00Z'))).toBeNull();
    expect(closesLine({ ...event, uploadWindowEndsAt: null }, now)).toBeNull();
  });

  it('falls back to a placeholder when nothing in the name can be printed', () => {
    expect(signContent({ ...event, name: '🎉🎉' }, 'https://x', 'x', now).eventName).toBe('Our event');
  });
});

describe('NFC store links', () => {
  it('offers regular and on-metal stickers over https', () => {
    expect(NFC_STORE_LINKS.map((l) => l.label)).toEqual(['NFC stickers', 'On-metal NFC stickers']);
    for (const link of NFC_STORE_LINKS) expect(new URL(link.url).protocol).toBe('https:');
  });

  it('ships without an affiliate claim', () => {
    // Flip this with the links, never alone: the card's disclosure reads it.
    expect(NFC_STORE_AFFILIATE).toBe(false);
  });
});
