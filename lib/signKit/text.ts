/**
 * Text that is safe to set in the PDF's built-in Helvetica.
 *
 * The standard PDF fonts only cover the Windows-1252 character set. Anything
 * outside it (emoji, CJK) would print as garbage, so it is dropped here rather
 * than shipped to a print shop. Accented Latin letters are inside the set and
 * survive.
 */

const PUNCTUATION: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  ' ': ' ',
};

export function pdfSafeText(input: string | null | undefined): string {
  if (!input) return '';
  let out = '';
  for (const ch of input.normalize('NFC')) {
    const mapped = PUNCTUATION[ch] ?? ch;
    const code = mapped.codePointAt(0) ?? 0;
    if (code === 0x2026 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += mapped;
    } else if (/\s/.test(mapped)) {
      out += ' ';
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Width of a string in inches, at a size in points. Supplied by the renderer. */
export type Measure = (text: string, sizePt: number, bold: boolean) => number;

/** Greedy word wrap. A single word wider than the line gets a line of its own. */
export function wrapText(
  text: string,
  maxWidth: number,
  sizePt: number,
  bold: boolean,
  measure: Measure,
): string[] {
  const words = text.split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, sizePt, bold) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Fit text in at most `maxLines`, shrinking from `sizePt` down to
 * `minSizePt`. If it still does not fit, the last line is cut with an
 * ellipsis — a long event name must never push the QR off the sign.
 */
export function fitText(
  text: string,
  maxWidth: number,
  maxLines: number,
  sizePt: number,
  minSizePt: number,
  bold: boolean,
  measure: Measure,
): { lines: string[]; sizePt: number } {
  const fits = (lines: string[], size: number) =>
    lines.length <= maxLines && lines.every((l) => measure(l, size, bold) <= maxWidth);
  for (let size = sizePt; size >= minSizePt - 1e-9; size -= sizePt * 0.05) {
    const lines = wrapText(text, maxWidth, size, bold, measure);
    if (fits(lines, size)) return { lines, sizePt: size };
  }
  const size = minSizePt;
  const lines = wrapText(text, maxWidth, size, bold, measure).slice(0, maxLines);
  const last = lines.length - 1;
  let cut = lines[last] ?? '';
  const truncated = wrapText(text, maxWidth, size, bold, measure).length > maxLines;
  if (truncated || measure(cut, size, bold) > maxWidth) {
    while (cut.length > 1 && measure(`${cut}…`, size, bold) > maxWidth) cut = cut.slice(0, -1);
    lines[last] = `${cut.trimEnd()}…`;
  }
  return { lines, sizePt: size };
}
