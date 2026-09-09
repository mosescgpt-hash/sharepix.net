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

describe('the read has not been switched over yet', () => {
  const api = codeOnly(readSource('lib/api.ts'));

  it('still lists a host their events by paging the model', () => {
    // Deliberate, and not caution about authorization — that was verified. A
    // secondary index added to a table that already holds data is backfilled by
    // DynamoDB asynchronously, and a query against it while that runs returns
    // an incomplete list. Showing a host some of their events is the failure
    // this whole thread of work exists to end, so the read moves in a separate
    // change once the index is live.
    const fn = api.slice(api.indexOf('export async function listMyEvents'));
    expect(fn.slice(0, 900)).toContain('client.models.Event.list(');
    expect(fn.slice(0, 900)).toContain('listAllPages(');
  });

  it('still checks what came back against who asked', () => {
    // A global admin has full model access, and this page shows their own
    // events.
    const fn = api.slice(api.indexOf('export async function listMyEvents'));
    expect(fn.slice(0, 900)).toContain('event.owner?.includes(user.userId)');
  });
});
