import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly, readSource } from './sourceGuards';

/**
 * The backend is type-checked, and stays that way.
 *
 * Every Lambda handler carried `@ts-nocheck` with the reason "@aws-sdk/* is
 * provided by the Lambda runtime, not installed as a dependency, so it's
 * excluded from the backend type-check".
 *
 * Half of that is true and the conclusion does not follow from it. The SDK is
 * indeed not a runtime dependency — the Lambda runtime supplies it, which is
 * why it belongs in devDependencies and does. But devDependencies are
 * installed, so the compiler has always been able to see those types, and
 * tsconfig.backend.json already includes amplify/**\/*.ts. Nothing excluded
 * these files except the pragma itself, and it hid 28 errors across 15 files.
 *
 * One of them was live — the Stripe period-end read that has been undefined
 * since Stripe's 2025-03-31 API version, leaving corporate renewal dates blank.
 * One was dead code the SDK silently ignored. Several were nullable values
 * being treated as strings inside a path that decides whether an upload is
 * safe.
 *
 * tsconfig.backend.json's own comment already recorded the cost: "Two of our
 * deploy failures came from that blind spot."
 */

const FUNCTIONS_DIR = join(__dirname, '..', 'amplify', 'functions');

function handlerPaths(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `amplify/functions/${entry.name}/handler.ts`)
    .filter((path) => {
      try {
        readSource(path);
        return true;
      } catch {
        // A function without a handler.ts of its own.
        return false;
      }
    });
}

describe('no handler switches the type checker off', () => {
  const paths = handlerPaths();

  it('finds the handlers to check', () => {
    // If this ever reads zero, the guard below is passing by looking at
    // nothing.
    expect(paths.length).toBeGreaterThan(20);
  });

  it.each(paths)('%s is type-checked', (path) => {
    const source = readSource(path);
    expect(source).not.toContain('@ts-nocheck');
    // An expect-error directive would be fine: it asserts an error exists and
    // fails once one stops existing. A ts-ignore silences without asserting
    // anything, which is the same hole in miniature. (Neither is spelled out
    // here — writing the first one in a comment makes it a real directive, and
    // the compiler then reports it as unused.)
    expect(source).not.toContain('@ts-' + 'ignore');
  });
});

describe('the reason the pragma gave', () => {
  it('the AWS SDK types are installed, so the compiler can see them', () => {
    // In devDependencies, which is the right place: the Lambda runtime provides
    // the SDK at execution, and the compiler needs it at build. Being absent
    // from `dependencies` was never a reason the handlers could not be checked.
    const pkg = JSON.parse(readSource('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(installed).toEqual(
      expect.arrayContaining(['@aws-sdk/client-dynamodb', '@aws-sdk/client-s3']),
    );
  });

  it('the backend config already includes the handlers', () => {
    const config = readSource('tsconfig.backend.json');
    expect(config).toContain('amplify/**/*.ts');
  });
});

describe('the live bug it was hiding', () => {
  const webhook = readSource('amplify/functions/stripe-webhook/handler.ts');

  it('reads the period end from the subscription item, not the subscription', () => {
    // Stripe moved it in the 2025-03-31 API version. Read off the subscription
    // it was undefined, so the renewal date and the download grace date were
    // written as empty strings and skipped.
    //
    // Against comment-stripped code, because the comment beside the fix quotes
    // the old expression while explaining it. That mistake has now been made
    // eight times in this repository, which is what sourceGuards is for.
    expect(webhook).toContain('subscription.items?.data?.find');
    expect(codeOnly(webhook)).not.toMatch(/subscription\.current_period_end/);
  });
});
