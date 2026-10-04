/**
 * The sign kit: print-ready PDFs a host downloads from the Signs page.
 *
 * Everything for the feature lives in this folder plus two pages
 * (pages/event/[eventId]/signs.tsx and nfc.tsx) and one link on the dashboard.
 * Removing it is deleting those and the link; nothing else imports from here.
 *
 * This file is the catalogue: what pieces exist, how big they print, and the
 * two colour variants. It is pure so the geometry can be tested without a
 * browser.
 */

/** Brand colours, exactly as the spec gives them. Nothing else is used. */
export const SIGN_COLORS = {
  navy: '#123851',
  mint: '#7AD8C0',
  green: '#099361',
  cream: '#FBEFD1',
  coral: '#F96742',
  yellow: '#FCBD08',
  outline: '#09080D',
} as const;

export type SignVariantKey = 'light' | 'dark';

export interface SignVariant {
  key: SignVariantKey;
  label: string;
  background: string;
  text: string;
  /** "No app needed", the kicker and the NFC mark. */
  emphasis: string;
  /**
   * The QR's quiet zone and the field behind it. Light in BOTH variants: a
   * scanner wants dark modules on a light field, and an inverted code on the
   * navy sign is the one that silently fails on older phones.
   */
  qrField: string;
  qrModules: string;
  /** A hairline around the QR field, only where it would otherwise vanish. */
  qrBorder: string | null;
  logoBody: string;
  logoDetail: string;
}

export const SIGN_VARIANTS: Record<SignVariantKey, SignVariant> = {
  light: {
    key: 'light',
    label: 'Light',
    background: SIGN_COLORS.cream,
    text: SIGN_COLORS.navy,
    // Green is only ~3.4:1 on cream, too weak for small type, so the light
    // variant emphasises with weight rather than colour.
    emphasis: SIGN_COLORS.navy,
    qrField: SIGN_COLORS.cream,
    qrModules: SIGN_COLORS.outline,
    qrBorder: SIGN_COLORS.navy,
    logoBody: SIGN_COLORS.navy,
    logoDetail: SIGN_COLORS.cream,
  },
  dark: {
    key: 'dark',
    label: 'Dark',
    background: SIGN_COLORS.navy,
    text: SIGN_COLORS.cream,
    emphasis: SIGN_COLORS.mint,
    qrField: SIGN_COLORS.cream,
    qrModules: SIGN_COLORS.outline,
    qrBorder: null,
    logoBody: SIGN_COLORS.cream,
    logoDetail: SIGN_COLORS.navy,
  },
};

/** The four accent dots under the event name. */
export const ACCENT_DOTS = [
  SIGN_COLORS.mint,
  SIGN_COLORS.green,
  SIGN_COLORS.coral,
  SIGN_COLORS.yellow,
] as const;

export type SignPieceKind = 'standard' | 'thanks' | 'card';

export interface SignPiece {
  key: string;
  label: string;
  /** Short line under the label on the Signs page. */
  use: string;
  /** Finished (trimmed) size in inches. */
  width: number;
  height: number;
  kind: SignPieceKind;
  /** Small all-caps line above the event name, if any. */
  kicker: string | null;
  /** Draw the "or tap here" NFC mark. */
  nfcMark: boolean;
  /** Bleed in inches. Non-zero also adds crop marks. */
  bleed: number;
  /** Smallest the QR symbol (modules only, quiet zone excluded) may print. */
  minQrSymbol: number;
}

/** The QR is at least this big everywhere except the small card. */
export const MIN_QR_SYMBOL = 2;
export const MIN_QR_SYMBOL_CARD = 1.25;
/** Modules of quiet zone on every side of the symbol. */
export const QUIET_ZONE_MODULES = 4;
/** Bleed on the poster, the only piece that goes to a print shop. */
export const POSTER_BLEED = 0.125;
/** Margin outside the bleed that holds the crop marks. */
export const CROP_SLUG = 0.5;

export const SIGN_PIECES: readonly SignPiece[] = [
  {
    key: 'table-tent-4x6',
    label: 'Table tent',
    use: '4 × 6 in. Fits a standard acrylic sign holder.',
    width: 4,
    height: 6,
    kind: 'standard',
    kicker: null,
    nfcMark: true,
    bleed: 0,
    minQrSymbol: MIN_QR_SYMBOL,
  },
  {
    key: 'table-tent-5x7',
    label: 'Table tent',
    use: '5 × 7 in. Fits a standard acrylic sign holder.',
    width: 5,
    height: 7,
    kind: 'standard',
    kicker: null,
    nfcMark: true,
    bleed: 0,
    minQrSymbol: MIN_QR_SYMBOL,
  },
  {
    key: 'welcome-8x10',
    label: 'Welcome sign',
    use: '8 × 10 in. For an easel or a frame at the entrance.',
    width: 8,
    height: 10,
    kind: 'standard',
    kicker: 'Welcome',
    nfcMark: true,
    bleed: 0,
    minQrSymbol: MIN_QR_SYMBOL,
  },
  {
    key: 'welcome-18x24',
    label: 'Welcome sign',
    use: '18 × 24 in poster. Has bleed and crop marks for a print shop.',
    width: 18,
    height: 24,
    kind: 'standard',
    kicker: 'Welcome',
    nfcMark: true,
    bleed: POSTER_BLEED,
    minQrSymbol: MIN_QR_SYMBOL,
  },
  {
    key: 'photo-spot-5x7',
    label: 'Bar or photo-spot sign',
    use: '5 × 7 in. For the bar, the photo booth or the guest book table.',
    width: 5,
    height: 7,
    kind: 'standard',
    kicker: 'Photo spot',
    nfcMark: false,
    bleed: 0,
    minQrSymbol: MIN_QR_SYMBOL,
  },
  {
    key: 'card-2x3.5',
    label: 'Small card',
    use: '2 × 3.5 in, business-card size. For favors and invitations.',
    width: 3.5,
    height: 2,
    kind: 'card',
    kicker: null,
    nfcMark: false,
    bleed: 0,
    minQrSymbol: MIN_QR_SYMBOL_CARD,
  },
  {
    key: 'thank-you-4x6',
    label: 'Thank-you insert',
    use: '4 × 6 in. Goes in thank-you cards so guests can add photos later.',
    width: 4,
    height: 6,
    kind: 'thanks',
    kicker: null,
    nfcMark: false,
    bleed: 0,
    minQrSymbol: MIN_QR_SYMBOL,
  },
];

export function signPiece(key: string): SignPiece | undefined {
  return SIGN_PIECES.find((piece) => piece.key === key);
}

/** "4 × 6 in" — the card is listed portrait-first, as people say it. */
export function pieceSizeLabel(piece: SignPiece): string {
  const [a, b] = [piece.width, piece.height].sort((x, y) => x - y);
  return `${a} × ${b} in`;
}

function eventSlug(eventName: string): string {
  return (
    eventName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'event'
  );
}

/** e.g. sharepix-anderson-wedding-table-tent-5x7-light.pdf */
export function signFilename(eventName: string, piece: SignPiece, variant: SignVariantKey): string {
  return `sharepix-${eventSlug(eventName)}-${piece.key}-${variant}.pdf`;
}

/** e.g. sharepix-anderson-wedding-signs.zip */
export function signKitZipName(eventName: string): string {
  return `sharepix-${eventSlug(eventName)}-signs.zip`;
}
