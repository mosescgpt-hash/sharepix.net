import { codeOnly, readSource } from './sourceGuards';

/**
 * Every per-event read goes through the eventId index, not a filtered Scan.
 *
 * ## Why it matters
 *
 * A `Scan` with a `FilterExpression` reads — and bills for — every row in the
 * table, then throws away the ones belonging to other events. The filter is
 * applied after the read, not before it. So the cost of opening one event's
 * guest book grew with every other event ever created, and the index that would
 * have fixed it was already declared and already being paid for on every write.
 *
 * ## Why it stayed broken
 *
 * The comment in `save-moment` gave the reason: the generated index name
 * "cannot be confirmed without a deploy; guessing wrong fails at runtime, in
 * production, on a path a host hits."
 *
 * That was wrong, and worth recording as wrong. `npm run validate:backend`
 * synthesises the whole CloudFormation locally, and the index names are in it.
 * No deploy, no guessing.
 *
 * ## What this pins
 *
 * The name in each handler against the model that generates it. A typo here is
 * invisible in every unit test and every typecheck — the code compiles, deploys,
 * and falls back to the Scan it was supposed to replace, logging as it goes. The
 * fallback means it never breaks, which is exactly why nobody would notice.
 */

const dataSchema = readSource('amplify/data/resource.ts');

interface Reader {
  /** The handler doing the per-event read. */
  handler: string;
  /** The model whose secondary index it queries. */
  model: string;
  /** The index name Amplify generates for that model's `index('eventId')`. */
  index: string;
}

const READERS: Reader[] = [
  { handler: 'list-event-photos', model: 'Photo', index: 'photosByEventId' },
  { handler: 'list-moments', model: 'Moment', index: 'momentsByEventId' },
  { handler: 'save-moment', model: 'Moment', index: 'momentsByEventId' },
  {
    handler: 'list-guest-book-entries',
    model: 'GuestBookEntry',
    index: 'guestBookEntriesByEventId',
  },
];

/** The body of one model's definition in the data schema. */
function modelBlock(model: string): string {
  const start = dataSchema.indexOf(`\n  ${model}: a`);
  expect({ model, declared: start !== -1 }).toEqual({ model, declared: true });
  const next = dataSchema.slice(start + 1).search(/\n {2}[A-Z][A-Za-z]*: a\b/);
  return next === -1 ? dataSchema.slice(start) : dataSchema.slice(start, start + 1 + next);
}

describe.each(READERS)('$handler', ({ handler, model, index }) => {
  const source = readSource(`amplify/functions/${handler}/handler.ts`);
  const code = codeOnly(source);

  it(`queries the ${index} index`, () => {
    expect(code).toContain(`'${index}'`);
    expect(code).toContain('IndexName');
    expect(code).toContain('QueryCommand');
  });

  it(`reads a model that actually declares an eventId index`, () => {
    // If the index is removed from the schema, the query starts failing and the
    // handler falls back to a Scan forever. This fails first.
    expect(modelBlock(model)).toContain("index('eventId')");
  });

  it('queries before it scans', () => {
    // Order is the whole point: a Scan reached first is not a fallback.
    const query = code.indexOf('QueryCommand');
    const scan = code.indexOf('ScanCommand');
    expect(query).toBeGreaterThan(-1);
    if (scan !== -1) expect(query).toBeLessThan(scan);
  });

  it('says something when it falls back', () => {
    // A silent fallback is the Scan coming back permanently with nobody told.
    if (!code.includes('ScanCommand')) return;
    expect(source).toContain('Falling back to a full table scan');
  });
});

describe('the index names follow one convention', () => {
  it('derives from the model name, so a new reader can work its own out', () => {
    // Amplify names the index after the plural of the model and the field:
    // Photo -> photosByEventId, Moment -> momentsByEventId,
    // GuestBookEntry -> guestBookEntriesByEventId.
    //
    // Pluralisation is the part worth spelling out, because "Entry" does not
    // take a bare "s" and that is precisely the kind of guess that ships broken.
    const plural = (model: string) =>
      model.endsWith('y') ? `${model.slice(0, -1)}ies` : `${model}s`;
    const camel = (word: string) => word.charAt(0).toLowerCase() + word.slice(1);

    for (const { model, index } of READERS) {
      expect({ model, index }).toEqual({ model, index: `${camel(plural(model))}ByEventId` });
    }
  });
});
