import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

/**
 * Turn the letter inside a markdown file into a Word document.
 *
 * ## Why this reads the markdown instead of repeating it
 *
 * The first Word document in this project was produced by a script that carried
 * its own hand-typed copy of the prose. Every edit then had to be made twice,
 * and the two drifted the first time somebody made only one of them. A letter to
 * a tax authority is a bad place for that: the copy that gets signed and posted
 * would be the one nobody re-read.
 *
 * So the markdown is the source. The letter is the block quote inside it —
 * everything at `> ` — and the reasoning around it stays in the repository where
 * it belongs rather than being posted to the Department.
 *
 *   node scripts/build-letter-docx.mjs docs/mn-print-tax-request.md out.docx
 */

const INK = '123851';
const CHARCOAL = '152833';
const RULE = 'D8D2C8';
const SAND = 'F0EBE3';
const CONTENT = 9360; // US Letter minus 1in margins, in DXA.

const [, , sourcePath, outPath] = process.argv;
if (!sourcePath || !outPath) {
  console.error('Usage: node scripts/build-letter-docx.mjs <source.md> <out.docx>');
  process.exit(1);
}

/**
 * The block quote, with its `> ` markers removed.
 *
 * Throws rather than producing an empty document: a zero-byte letter that looks
 * like a successful build is worse than a failure.
 */
function letterOf(markdown) {
  const lines = markdown.split('\n');
  const quoted = [];
  let inQuote = false;
  for (const line of lines) {
    if (line.startsWith('> ') || line === '>') {
      inQuote = true;
      quoted.push(line.replace(/^> ?/, ''));
    } else if (inQuote && line.trim() === '') {
      // A blank line inside the quote ends it only if the quote does not resume.
      quoted.push('');
    } else if (inQuote) {
      break;
    }
  }
  const text = quoted.join('\n').trim();
  if (!text) throw new Error(`No "> " block quote found in ${sourcePath}.`);
  return text;
}

/** `**bold**` and `*italic*` become runs; everything else is literal. */
function inline(text, base = {}) {
  const out = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(new TextRun({ text: text.slice(last, match.index), ...base }));
    const token = match[0];
    out.push(
      ...(token.startsWith('**')
        ? inline(token.slice(2, -2), { ...base, bold: true })
        : inline(token.slice(1, -1), { ...base, italics: true })),
    );
    last = match.index + token.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out.length ? out : [new TextRun({ text: '', ...base })];
}

/**
 * Inline formatting, plus a hard line break wherever the source ended a line
 * with a backslash.
 *
 * An address block is five short lines that are not five paragraphs, and the
 * line-joining below cannot tell one from a wrapped sentence. CommonMark's
 * backslash break is the signal: it renders as a break on GitHub too, so the
 * markdown and the Word document agree about where the lines are.
 */
function runs(text, base = {}) {
  const out = [];
  text.split('\n').forEach((part, index) => {
    if (index > 0) out.push(new TextRun({ break: 1, ...base }));
    out.push(...inline(part, base));
  });
  return out;
}

const body = (text, opts = {}) =>
  new Paragraph({ children: runs(text), spacing: { after: 160, line: 276 }, ...opts });

const heading = (text) =>
  new Paragraph({
    children: [new TextRun({ text, bold: true, size: 26, color: INK })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 140 },
  });

const bullet = (text) =>
  new Paragraph({
    children: runs(text),
    bullet: { level: 0 },
    spacing: { after: 110, line: 276 },
  });

const numbered = (text, index) =>
  new Paragraph({
    children: runs(`${index}. ${text}`),
    indent: { left: 360, hanging: 360 },
    spacing: { after: 110, line: 276 },
  });

function tableFrom(rows) {
  const widths = [CONTENT * 0.6, CONTENT * 0.4].map(Math.round);
  const cell = (text, width, head) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: head ? { type: ShadingType.CLEAR, fill: SAND } : undefined,
      margins: { top: 90, bottom: 90, left: 130, right: 130 },
      children: [new Paragraph({ children: runs(text, head ? { bold: true } : {}) })],
    });
  return new Table({
    columnWidths: widths,
    width: { size: CONTENT, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: rows.map(
      (row, index) =>
        new TableRow({
          tableHeader: index === 0,
          children: row.map((text, column) => cell(text, widths[column], index === 0)),
        }),
    ),
  });
}

/**
 * A block's full text, following its continuation lines.
 *
 * Returns the joined text and the index of the last line consumed. Wrapped
 * lines rejoin with a space; a line ending in `\` keeps its break. `indented`
 * distinguishes a list item, whose continuations are indented and whose next
 * sibling is not, from an ordinary paragraph, which runs until a blank line or
 * a line that starts a different kind of block.
 */
function joinFrom(lines, start, first, indented) {
  const continues = (line) => {
    if (indented) return /^\s{2,}\S/.test(line);
    const t = line.trim();
    return t !== '' && !t.startsWith('-') && !t.startsWith('|') && !/^\d+\.\s/.test(t);
  };

  const parts = [first];
  let i = start;
  while (i + 1 < lines.length && continues(lines[i + 1])) {
    i += 1;
    parts.push(lines[i].trim());
  }

  let text = '';
  parts.forEach((part, index) => {
    const hard = part.endsWith('\\');
    text += hard ? `${part.slice(0, -1).trimEnd()}\n` : part;
    if (!hard && index < parts.length - 1) text += ' ';
  });
  return { text, end: i };
}

/** Markdown lines to docx blocks. Handles only what the letters actually use. */
function render(letter) {
  const lines = letter.split('\n');
  const blocks = [];
  let pendingTable = [];
  let counter = 0;

  const flushTable = () => {
    if (pendingTable.length === 0) return;
    blocks.push(tableFrom(pendingTable));
    blocks.push(new Paragraph({ text: '', spacing: { after: 160 } }));
    pendingTable = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('|')) {
      // Separator rows (`| --- |`) carry no content.
      if (!/^\|[\s:|-]+\|$/.test(trimmed)) {
        pendingTable.push(
          trimmed
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim()),
        );
      }
      continue;
    }
    flushTable();

    if (trimmed === '') {
      counter = 0;
      continue;
    }
    if (trimmed.startsWith('**') && trimmed.endsWith('**') && !trimmed.slice(2, -2).includes('**')) {
      blocks.push(heading(trimmed.slice(2, -2)));
      continue;
    }
    if (trimmed.startsWith('- ')) {
      const item = joinFrom(lines, i, trimmed.slice(2), true);
      i = item.end;
      blocks.push(bullet(item.text));
      continue;
    }
    const ordered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    if (ordered) {
      counter = Number(ordered[1]);
      const item = joinFrom(lines, i, ordered[2], true);
      i = item.end;
      blocks.push(numbered(item.text, counter));
      continue;
    }

    const paragraph = joinFrom(lines, i, trimmed, false);
    i = paragraph.end;
    blocks.push(body(paragraph.text));
  }
  flushTable();
  return blocks;
}

const markdown = readFileSync(sourcePath, 'utf8');
const letter = letterOf(markdown);
const blocks = render(letter);

const doc = new Document({
  creator: 'SharePix LLC',
  title: basename(outPath, '.docx'),
  description: `Generated from ${sourcePath}. Edit the markdown, not this file.`,
  styles: { default: { document: { run: { font: 'Calibri', size: 22, color: CHARCOAL } } } },
  sections: [
    {
      properties: {
        page: {
          // US Letter. docx-js defaults to A4, which is the wrong paper for a
          // letter posted to a US state agency.
          size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: blocks,
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(
  `wrote ${outPath} (${(buffer.length / 1024).toFixed(0)}KB) from the block quote in ${sourcePath}`,
);
console.log(`${blocks.length} blocks. Edit the markdown and re-run; do not edit the .docx.`);

// A quick sanity line, because a letter that silently lost its questions would
// still open fine in Word.
const questions = (letter.match(/^\d+\.\s/gm) ?? []).length;
console.log(`${questions} numbered question${questions === 1 ? '' : 's'} carried across.`);
