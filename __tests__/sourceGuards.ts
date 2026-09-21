import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Helpers for tests that assert something is ABSENT from a source file.
 *
 * ## Why this file exists
 *
 * Five separate guards in this codebase have now been written as
 * `expect(source).not.toContain('X')` and have then matched the COMMENT
 * explaining why X is deliberately absent. Every one of them failed on honest
 * text, and each was fixed in place by the next person to notice — which is
 * how it happened five times.
 *
 * The mistake is structural rather than careless: a guard that means "this code
 * does not do X" is asking about code, and a file's prose is the one part
 * guaranteed to mention X, because that is where the reason lives.
 *
 * Not a test file: `jest.config.js` matches `*.test.ts`, so this is imported
 * rather than run.
 */

const root = join(__dirname, '..');

/** Read a repository file, by path from the root. */
export function readSource(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

/**
 * A source file with its comments removed.
 *
 * ## Why this is a scanner and not three regexes
 *
 * It used to be three `replace` calls, documented as "deliberately naive about
 * strings that look like comments" on the reasoning that stripping too much is
 * safe for an absence check. That reasoning was sound and covered half the
 * callers: plenty of guards use this for **presence** checks, where removing
 * too much is not a false pass but a false failure.
 *
 * It then happened. An IAM policy in `backend.ts` scoped a permission to
 * `'demo/*'`, the slash-star inside that string literal opened a block comment
 * that ran to the next `*​/` hundreds of lines later, and eleven unrelated
 * guards across four files failed at once — none of them anywhere near the
 * change, all of them reporting that code they could see in the file was
 * missing.
 *
 * So string and template literals are now skipped. Everything else is as it
 * was: block comments, JSX expression comments and line comments all go.
 */
export function codeOnly(source: string): string {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    // A string or template literal is copied through untouched, so a `/*` or
    // `//` inside one is data rather than the start of a comment.
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      out += char;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          // An escape takes the next character with it, so a `\"` does not end
          // the literal.
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        // An unterminated single-quoted string would otherwise run to the end
        // of the file; a newline ends it, as it does in JavaScript.
        if (source[i] === '\n' && quote !== '`') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

/** Read a file and strip its comments in one step. */
export function readCode(path: string): string {
  return codeOnly(readSource(path));
}

/**
 * The body of a module after its opening doc comment.
 *
 * What the drift guards compare, so a Lambda's hand-copied module can carry a
 * different header while its actual code stays byte-identical.
 */
export function bodyOf(source: string): string {
  return source.slice(source.indexOf('*/') + 2).trim();
}

/**
 * Prose with its wrapping and markdown emphasis normalised away.
 *
 * For the opposite kind of guard — asserting a file DOES say something. A
 * phrase in a doc comment is wrapped across lines and may carry `**emphasis**`,
 * so matching it literally fails for reasons that have nothing to do with
 * whether the file says it.
 */
export function proseOf(source: string): string {
  return source.replace(/[*]/g, '').replace(/\s+/g, ' ');
}
