/**
 * Fail the build on a circular dependency between nested CloudFormation stacks.
 *
 * ## Why this exists
 *
 * Four consecutive production deploys failed with
 * `CloudformationStackCircularDependencyError` while every check in CI stayed
 * green, because `validate:backend` synthesises the app and synthesis does not
 * resolve nested-stack cycles — only CloudFormation does, at deploy time. The
 * result was four merges reported as shipped that never reached production.
 *
 * The cycle was introduced by granting a STORAGE-stack function (the S3
 * onUpload trigger) access to DATA-stack tables, while data-stack functions
 * have always needed the bucket. storage -> data plus data -> storage.
 *
 * ## How it detects one
 *
 * The root template wires nested stacks together by passing one stack's
 * `Outputs.X` into another's `Parameters` via `Fn::GetAtt`. That is exactly the
 * dependency CloudFormation resolves, so reading those references back out of
 * the synthesised root template reconstructs the same graph it will build — no
 * AWS call, no credentials, no deploy.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const outdir = process.argv[2];
if (!outdir) {
  console.error('usage: check-stack-cycles.mjs <cdk.out dir>');
  process.exit(2);
}

const root = readdirSync(outdir).find(
  (f) => f.endsWith('.template.json') && !f.includes('.nested.'),
);
if (!root) {
  console.error(`No root template found in ${outdir}`);
  process.exit(2);
}

const template = JSON.parse(readFileSync(join(outdir, root), 'utf8'));
const resources = template.Resources ?? {};

/** Every logical id in the root template that is itself a nested stack. */
const stacks = new Set(
  Object.entries(resources)
    .filter(([, r]) => r?.Type === 'AWS::CloudFormation::Stack')
    .map(([id]) => id),
);

/** Every `Fn::GetAtt` target inside a value, however deeply nested. */
function referencedStacks(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) referencedStacks(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'Fn::GetAtt' && Array.isArray(inner) && stacks.has(inner[0])) {
        found.add(inner[0]);
      }
      referencedStacks(inner, found);
    }
  }
  return found;
}

// edges: stack -> the stacks it depends on
const edges = new Map();
for (const id of stacks) {
  const deps = referencedStacks(resources[id]?.Properties?.Parameters ?? {});
  for (const explicit of resources[id]?.DependsOn ?? []) {
    if (stacks.has(explicit)) deps.add(explicit);
  }
  deps.delete(id);
  edges.set(id, deps);
}

// Depth-first search, reporting the actual cycle path rather than just "there
// is one" — the path is what tells you which grant to move.
const cycles = [];
const state = new Map();
const path = [];
function visit(node) {
  state.set(node, 'open');
  path.push(node);
  for (const next of edges.get(node) ?? []) {
    if (state.get(next) === 'open') {
      cycles.push([...path.slice(path.indexOf(next)), next]);
    } else if (!state.has(next)) {
      visit(next);
    }
  }
  path.pop();
  state.set(node, 'done');
}
for (const id of stacks) if (!state.has(id)) visit(id);

if (cycles.length === 0) {
  console.log(`No circular dependency across ${stacks.size} nested stacks.`);
  process.exit(0);
}

console.error('Circular dependency between nested stacks — this WILL fail to deploy:\n');
const seen = new Set();
for (const cycle of cycles) {
  const key = [...cycle].sort().join('|');
  if (seen.has(key)) continue;
  seen.add(key);
  console.error(`  ${cycle.join(' -> ')}`);
}
console.error(
  '\nA function is reaching across stacks in both directions. Move it with' +
    "\n`resourceGroupName` in its defineFunction call, or drop the grant that" +
    '\ncloses the loop. See scripts/check-stack-cycles.mjs.',
);
process.exit(1);
