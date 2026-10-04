/**
 * The QR symbol as a grid of modules, so the PDF can draw it as vector
 * rectangles rather than embedding a picture of it.
 *
 * Uses qrcode-generator, the encoder qr-code-styling already runs on (same
 * version, deduped in the lockfile) — the sign kit reuses the repo's QR stack
 * rather than adding a second one. It is listed directly in package.json only
 * so this import does not lean on a transitive dependency.
 *
 * Error correction is Q (25%): the spec's level. The host's centre logo is not
 * drawn on signs, so the extra recovery H buys for covering modules is not
 * needed, and Q keeps the modules larger at the same printed size.
 */
import qrcode from 'qrcode-generator';

export type QrMatrix = boolean[][];

export function qrMatrix(data: string): QrMatrix {
  // Type 0 picks the smallest version that holds the data at this level.
  const qr = qrcode(0, 'Q');
  qr.addData(data, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const rows: QrMatrix = [];
  for (let r = 0; r < count; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < count; c += 1) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/**
 * Dark modules merged into horizontal runs: one rectangle per run instead of
 * one per module, which keeps the PDF small and avoids hairline seams between
 * neighbouring squares in some viewers. Coordinates are in modules.
 */
export function qrRuns(matrix: QrMatrix): Array<{ row: number; col: number; length: number }> {
  const runs: Array<{ row: number; col: number; length: number }> = [];
  matrix.forEach((row, r) => {
    let start = -1;
    for (let c = 0; c <= row.length; c += 1) {
      const dark = c < row.length && row[c];
      if (dark && start < 0) start = c;
      if (!dark && start >= 0) {
        runs.push({ row: r, col: start, length: c - start });
        start = -1;
      }
    }
  });
  return runs;
}
