import { codeOnly, readSource } from './sourceGuards';

/**
 * The index that makes "my events" a Query instead of a Scan.
 *
 * Owner authorization does not give you one. With no index it resolves to a
 * Scan with the owner condition as a FILTER, and DynamoDB applies the page
 * limit to rows READ and only then filters — so finding one host's events means
 * reading everybody's, and a host whose rows sat past the first page used to get
 * an empty answer. Pagination made that correct; this makes it cheap.
 *
 * ## Why the field had to be declared
 *
 * `allow.owner()` stores the owner in a field the model does not declare, and
 * `secondaryIndexes` will not index a field that is not there. So `owner` is
 * declared and the rule becomes `ownerDefinedIn('owner')`.
 *
 * That is an authorization change on the model that separates one host's events
 * from another's, so it was verified against the synthesised output rather than
 * reasoned about. The generated `@auth` directive is byte-identical before and
 * after — `allow.owner()` already compiled to `ownerField: "owner"`, which is
 * exactly what `ownerDefinedIn('owner')` produces. Of 157 resolver templates,
 * three changed, all of them by adding "owner" to the ADMINS field lists on
 * create and update (a role that already carried isAuthorizedOnAllFields) and
 * by stripping a null owner before an indexed write. Every get, list and delete
 * resolver is unchanged, byte for byte.
 */

const schema = readSource('amplify/data/resource.ts');
const eventModel = schema.slice(schema.indexOf('Event: a'), schema.indexOf('Photo: a'));

describe('the owner field', () => {
  it('is declared, so it can be indexed', () => {
    expect(codeOnly(eventModel)).toContain('owner: a.string()');
  });

  it('is indexed', () => {
    expect(codeOnly(eventModel)).toContain("secondaryIndexes((index) => [index('owner')])");
  });

  it('is what the authorization rule names', () => {
    // The same field the rule reads and the index keys on. Two different names
    // here would mean an index that answers a question about somebody else.
    expect(codeOnly(eventModel)).toContain("allow.ownerDefinedIn('owner').to(['get', 'list', 'delete'])");
  });

  it('grants hosts no create or update, as before', () => {
    // The declaration changed how the owner is stored, not what a host may do.
    // Every field on this row is money or lifecycle; createEvent and
    // updateEventSettings remain the only writers.
    const auth = eventModel.slice(eventModel.indexOf('.authorization'));
    expect(auth).not.toContain("'create'");
    expect(auth).not.toContain("'update'");
  });
});

describe('what still writes the owner', () => {
  it('is the createEvent function, from the identity', () => {
    // Built from the verified token, never from the request — which is what
    // stops a host creating an event owned by someone else, and is unaffected
    // by any of this.
    const handler = codeOnly(readSource('amplify/functions/create-event/handler.ts'));
    expect(handler).toContain('ownerStringFor(sub');
    expect(handler).toContain('owner: { S: owner }');
  });

  it('still writes the two shapes ownerStringFor produces', () => {
    // "<sub>::<username>", or the bare sub when the identity carried no
    // username. Both are indexed the same way; AppSync builds the claim list it
    // matches against from the caller's own identity, so neither shape needs
    // the client to guess.
    const rules = codeOnly(readSource('amplify/functions/create-event/newEvent.ts'));
    expect(rules).toContain('return name ? `${id}::${name}` : id;');
  });
});

describe('the read', () => {
  const api = codeOnly(readSource('lib/api.ts'));
  const fn = api.slice(api.indexOf('export async function listMyEvents'));

  it('queries the index rather than paging the whole table', () => {
    expect(fn.slice(0, 1200)).toContain('client.models.Event.listEventByOwner(');
    expect(fn.slice(0, 1200)).not.toContain('client.models.Event.list(');
  });

  it('still reads every page of the result', () => {
    // An index makes the query cheap; it does not make one page enough.
    expect(fn.slice(0, 1200)).toContain('listAllPages(');
  });

  it('asks for both shapes the owner string can take', () => {
    // "<sub>::<username>" and the bare sub. For an ordinary host this is belt
    // and braces — AppSync overwrites the argument with the caller's own claims
    // — but a global admin is authorized by their group first, so that
    // substitution is skipped and the value sent is the value used. Asking for
    // only the usual shape would show such an admin none of their own events.
    expect(api).toContain('function ownerCandidates(');
    expect(api).toContain('`${sub}::${user.username}`');
  });

  it('de-duplicates across the two queries', () => {
    // Both candidates can return the same row once AppSync has substituted the
    // caller's claims into each.
    expect(fn.slice(0, 1200)).toContain('byId.set(row.id, row)');
  });

  it('still checks what came back against who asked', () => {
    // A global admin has full model access, and this page shows their own
    // events. An index is also a denormalised copy: checking the answer against
    // the question costs nothing and stops a wrong one passing quietly.
    expect(fn.slice(0, 1200)).toContain('event.owner?.includes(user.userId)');
  });
});
