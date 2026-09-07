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
 * Strips block comments, JSX expression comments and line comments, in that
 * order. Deliberately naive about strings that look like comments — a `//` in a
 * URL inside a string literal is removed too. That direction is safe for an
 * absence check: it can only remove more, so a guard can produce a false pass
 * on a URL but never a false failure on a sentence.
 */
export function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');
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
