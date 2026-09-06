import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The free-event limit is not enforced by any code path — it is enforced by
 * what the FreeEventClaim model does NOT grant.
 *
 * If a host can delete their own claim row, "one free event per account" means
 * nothing: create a free event, delete the claim, create another, forever. No
 * test of the create-event function would catch that, because create-event
 * would be behaving perfectly. The hole would be in six words of schema.
 *
 * So this reads the schema as text. It is a blunt instrument and deliberately
 * so: the failure it guards against is someone adding `allow.owner()` while
 * tidying up, and text is what that person would be editing.
 */

const source = readFileSync(
  join(__dirname, '..', 'amplify', 'data', 'resource.ts'),
  'utf8',
);

/** The FreeEventClaim model definition, from its key to the end of its authorization. */
function claimModelBlock(): string {
  const start = source.indexOf('FreeEventClaim: a');
  expect(start).toBeGreaterThan(-1);
  const auth = source.indexOf('.authorization(', start);
  expect(auth).toBeGreaterThan(start);
  const end = source.indexOf(']),', auth);
  expect(end).toBeGreaterThan(auth);
  return source.slice(start, end + 3);
}

describe('the FreeEventClaim model', () => {
  it('exists, and is what create-event writes the claim into', () => {
    expect(source).toContain('FreeEventClaim: a');
  });

  it('grants admins and nobody else', () => {
    expect(claimModelBlock()).toContain("allow.group('ADMINS')");
  });

  it('never grants the owner anything, which is the entire limit', () => {
    // The row id is the host's own Cognito sub, so an owner rule here would be
    // handing every host the delete button on their own limit.
    const block = claimModelBlock();
    expect(block).not.toContain('allow.owner');
    expect(block).not.toContain('ownerDefinedIn');
  });

  it('grants no guest or authenticated access at all', () => {
    // A signed-in host reading the table would learn nothing dangerous, but
    // `list` plus any write is how a limit turns into a suggestion.
    const block = claimModelBlock();
    expect(block).not.toContain('allow.guest');
    expect(block).not.toContain('allow.authenticated');
    expect(block).not.toContain('allow.publicApiKey');
  });

  it('records the event a claim was spent on, not just a date', () => {
    // An admin deciding whether to clear a claim is usually looking at a
    // support email about one specific event.
    const block = claimModelBlock();
    expect(block).toContain('eventId');
    expect(block).toContain('claimedAt');
  });
});

describe('the create-event function is the only writer', () => {
  const handler = readFileSync(
    join(__dirname, '..', 'amplify', 'functions', 'create-event', 'handler.ts'),
    'utf8',
  );

  it('claims with a conditional put, so two requests cannot both win', () => {
    // Without the condition this is a plain overwrite and clicking twice, or
    // two tabs, produces two free events.
    expect(handler).toContain('ConditionExpression: \'attribute_not_exists(id)\'');
    expect(handler).toContain('ConditionalCheckFailedException');
  });

  it('refuses rather than allows when the claim table is missing', () => {
    // Every other optional table in that file degrades open because it is
    // cosmetic. This one IS the limit: a deploy that lost the environment
    // variable must not hand out unlimited free events in silence.
    const claim = handler.slice(handler.indexOf('async function claimFreeEvent'));
    const guard = claim.slice(0, claim.indexOf('try {'));
    expect(guard).toContain('if (!FREE_CLAIM_TABLE)');
    expect(guard).toContain('throw new Error');
  });

  it('releases the claim when the event write fails', () => {
    // A failed creation must not silently burn the host's only free event.
    expect(handler).toContain('releaseFreeEvent(sub)');
  });
});
