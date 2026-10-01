import {
  MAX_ENTRIES_PER_ADDRESS,
  MAX_ENTRIES_PER_EVENT,
  MAX_ENTRIES_PER_GUEST,
} from '../lib/guestBook';
import { codeOnly, readSource } from './sourceGuards';

/**
 * The limits that live in the QuotaCounter table.
 *
 * Like FreeEventClaim, these are enforced as much by what the schema does NOT
 * grant as by any handler: a host or guest who could write or delete a
 * counter row could lift their own limit. So most of this reads source, and
 * reads it as code rather than prose (see sourceGuards.ts).
 */

const schema = readSource('amplify/data/resource.ts');
const backend = codeOnly(readSource('amplify/backend.ts'));

function modelBlock(name: string): string {
  const start = schema.indexOf(`${name}: a`);
  expect(start).toBeGreaterThan(-1);
  const end = schema.indexOf(']),', schema.indexOf('.authorization(', start));
  return schema.slice(start, end + 3);
}

describe('the QuotaCounter model', () => {
  it('grants admins and nobody else', () => {
    const block = modelBlock('QuotaCounter');
    expect(block).toContain("allow.group('ADMINS')");
    for (const rule of ['allow.owner', 'allow.guest', 'allow.authenticated', 'allow.publicApiKey']) {
      expect(block).not.toContain(rule);
    }
  });

  it('is wired to the two functions that enforce it', () => {
    expect(backend).toContain('quotaTable.grantReadWriteData(createEventFn)');
    expect(backend).toContain("createEventFn.addEnvironment('QUOTA_TABLE_NAME'");
    expect(backend).toContain('quotaTable.grantReadWriteData(guestBookWriteFn)');
    expect(backend).toContain("guestBookWriteFn.addEnvironment('QUOTA_TABLE_NAME'");
  });
});

describe('the daily free-event allowance', () => {
  const handler = codeOnly(readSource('amplify/functions/create-event/handler.ts'));

  it('is a conditional increment, so the last one cannot be taken twice', () => {
    expect(handler).toContain("ConditionExpression: 'attribute_not_exists(#count) OR #count < :cap'");
    expect(handler).toContain('trial-day#');
  });

  it('defaults to 25 a day and refuses when its table is missing', () => {
    expect(handler).toContain('const DEFAULT_FREE_EVENTS_PER_DAY = 25;');
    const take = handler.slice(
      handler.indexOf('async function takeTrialAllowance'),
      handler.indexOf('function trialDayKey'),
    );
    expect(take).toContain('if (!QUOTA_TABLE)');
    expect(take).toContain('throw new Error');
  });

  it('gives the account claim back when the day is full', () => {
    // Otherwise a host refused for today would lose their one free event.
    const flow = handler.slice(handler.indexOf('await claimFreeEvent(sub, id, nowISO);'));
    expect(flow.indexOf('await takeTrialAllowance(nowISO);')).toBeGreaterThan(-1);
    expect(flow.indexOf('await releaseFreeEvent(sub);')).toBeGreaterThan(
      flow.indexOf('await takeTrialAllowance(nowISO);'),
    );
  });

  it('gives everything back when the event write fails', () => {
    const fail = handler.slice(handler.indexOf('await putEvent(item);'));
    expect(fail).toContain('await releaseTrialAllowance(nowISO);');
  });

  it('reads an old ?tier=free link as the current trial', () => {
    expect(handler).toContain("requested === 'free' ? CURRENT_TRIAL_TIER : requested");
  });
});

describe('the Corporate monthly allowance', () => {
  const handler = codeOnly(readSource('amplify/functions/create-event/handler.ts'));
  const take = handler.slice(
    handler.indexOf('async function takeCorporateMonthly'),
    handler.indexOf('async function releaseCorporateMonthly'),
  );

  it('counts per subscriber per UTC month, so it resets on the 1st by itself', () => {
    expect(handler).toContain('`corporate-month#${sub}#${nowISO.slice(0, 7)}`');
  });

  it('is a conditional increment, so the tenth cannot be taken twice', () => {
    expect(take).toContain("ConditionExpression: 'attribute_not_exists(#count) OR #count < :cap'");
    expect(take).toContain('String(CORPORATE_INCLUDED_EVENTS)');
  });

  it('is not a cap on events running at once', () => {
    // The first version held a place per event for its whole upload window,
    // which came to about five new events a month instead of ten.
    expect(handler).not.toContain('corporate-seat#');
    expect(handler).not.toContain('expiresAt < :now');
  });

  it('turns an event past the month’s allowance into an unpaid extra, never a free one', () => {
    expect(handler).toContain('corporateIncluded: false');
    expect(handler).toContain('row.paid = false');
  });

  it('never counts an event as included when its table is missing', () => {
    expect(take).toMatch(/if \(!QUOTA_TABLE\) \{[^}]*return false;/);
  });

  it('gives the month’s event back when the event write fails', () => {
    const fail = handler.slice(handler.indexOf('await putEvent(item);'));
    expect(fail).toContain('await releaseCorporateMonthly(sub, nowISO);');
  });
});

describe('the guest book, per guest', () => {
  const handler = codeOnly(readSource('amplify/functions/create-guest-book-entry/handler.ts'));

  it('bounds one guest well below the event, and one address below that', () => {
    expect(MAX_ENTRIES_PER_GUEST).toBeLessThan(MAX_ENTRIES_PER_ADDRESS);
    // A single address must not be able to fill the book either.
    expect(MAX_ENTRIES_PER_ADDRESS).toBeLessThanOrEqual(MAX_ENTRIES_PER_EVENT / 10);
  });

  it('checks the guest and the address before the event ceiling', () => {
    const guest = handler.indexOf('MAX_ENTRIES_PER_GUEST, eventId');
    const address = handler.indexOf('MAX_ENTRIES_PER_ADDRESS, eventId');
    const event = handler.indexOf("UpdateExpression: 'ADD guestBookCount :one");
    expect(guest).toBeGreaterThan(-1);
    expect(address).toBeGreaterThan(guest);
    expect(event).toBeGreaterThan(address);
  });

  it('identifies the signer from the request identity, never the body', () => {
    expect(handler).toContain('signerKeys(event.identity, eventId)');
    expect(handler).not.toContain('arguments.guestKey');
  });

  it('hands counted notes back when a later step refuses', () => {
    expect((handler.match(/await giveBack\(\);/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('what hosts are told', () => {
  it('says next to the QR code that it is hidden from search but open to anyone holding it', () => {
    const qr = readSource('components/EventQRCode.tsx');
    expect(qr).toContain('Private from search');
    expect(qr).toContain('Anyone you give this QR code or link to can view it and add photos.');
  });

  it('calls guest book screening a link check, beside the notes', () => {
    const moderation = readSource('components/GuestBookModeration.tsx');
    expect(moderation).toContain('GUEST_BOOK_SCREENING_NOTE');
    const rules = readSource('lib/guestBook.ts');
    expect(rules).toMatch(/words themselves are not checked/);
  });

  it('no longer calls the gallery private on the pricing page', () => {
    expect(codeOnly(readSource('pages/pricing.tsx'))).not.toContain('Private by default');
  });
});
