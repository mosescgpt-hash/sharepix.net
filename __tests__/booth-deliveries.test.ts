import { readFileSync } from 'fs';
import { BUSINESS_ADDRESS_LINES } from '../lib/businessInfo';
import {
  POSTAL_ADDRESS_LINES,
  buildBoothMessage,
  formatRemovalDate,
} from '../amplify/functions/booth-deliveries/message';
import { deliveryDue, reminderDue, removalDue } from '../amplify/functions/booth-deliveries/plan';
import { originalsRemovedAt, reminderAt } from '../amplify/functions/booth-deliveries/retention';
import { mayManage } from '../amplify/functions/booth-deliveries/handler';
import { codeOnly, readSource } from './sourceGuards';

const person = { email: 'a@example.com', emailsStopped: false, deliveredCount: 0, reminderSentAt: null };

describe('when a booth attendee is emailed', () => {
  it('sends "ready" for the first approved photos, then "more" only when the count grows', () => {
    expect(deliveryDue(person, 0)).toBeNull();
    expect(deliveryDue(person, 3)).toBe('ready');
    expect(deliveryDue({ ...person, deliveredCount: 3 }, 3)).toBeNull();
    expect(deliveryDue({ ...person, deliveredCount: 3 }, 5)).toBe('more');
    // A photo taken back off someone doesn't email them.
    expect(deliveryDue({ ...person, deliveredCount: 3 }, 2)).toBeNull();
  });

  it('never emails someone who stopped emails or has no address', () => {
    expect(deliveryDue({ ...person, emailsStopped: true }, 3)).toBeNull();
    expect(deliveryDue({ ...person, email: null }, 3)).toBeNull();
  });

  it('reminds once, a week before removal, and only people who were sent photos', () => {
    const removed = '2027-02-07T23:59:59.000Z';
    const from = reminderAt(removed);
    expect(from).toBe('2027-01-31T23:59:59.000Z');
    const sent = { ...person, deliveredCount: 2 };
    expect(reminderDue(sent, '2027-01-31T23:00:00.000Z', from, removed)).toBe(false);
    expect(reminderDue(sent, '2027-02-01T09:00:00.000Z', from, removed)).toBe(true);
    expect(reminderDue(sent, '2027-02-08T09:00:00.000Z', from, removed)).toBe(false);
    expect(reminderDue(person, '2027-02-01T09:00:00.000Z', from, removed)).toBe(false);
    expect(reminderDue({ ...sent, reminderSentAt: 'x' }, '2027-02-01T09:00:00.000Z', from, removed)).toBe(false);
    expect(reminderDue({ ...sent, emailsStopped: true }, '2027-02-01T09:00:00.000Z', from, removed)).toBe(false);
  });
});

describe('the 30-day retention', () => {
  it('counts 30 days from the end of the event day, or from creation', () => {
    expect(originalsRemovedAt({ date: '2027-01-08' })).toBe('2027-02-07T23:59:59.000Z');
    expect(originalsRemovedAt({ date: null, createdAt: '2027-01-08T10:00:00.000Z' })).toBe(
      '2027-02-07T10:00:00.000Z',
    );
    expect(originalsRemovedAt({ date: 'soon', createdAt: null })).toBeNull();
  });

  it('removes once, on or after the date', () => {
    const at = '2027-02-07T23:59:59.000Z';
    expect(removalDue('2027-02-07T23:00:00.000Z', at, null)).toBe(false);
    expect(removalDue('2027-02-08T00:20:00.000Z', at, null)).toBe(true);
    expect(removalDue('2027-02-08T00:20:00.000Z', at, '2027-02-08T00:20:00.000Z')).toBe(false);
    expect(removalDue('2027-02-08T00:20:00.000Z', null, null)).toBe(false);
  });

  it('is the same rule in the gallery, which shows the date', () => {
    const read = (p: string) => readFileSync(p, 'utf8');
    expect(read('amplify/functions/booth-gallery/retention.ts')).toBe(
      read('amplify/functions/booth-deliveries/retention.ts'),
    );
  });
});

describe('the emails', () => {
  const base = {
    attendeeName: 'Alex Rivera',
    eventName: 'Acme at CES',
    galleryUrl: 'https://www.sharepix.net/booth/photos/KEY',
    stopUrl: 'https://www.sharepix.net/booth/photos/KEY?stop=1',
    photoCount: 3,
    removedOn: 'Sunday, February 7',
  };

  it('carry the gallery link, a stop link and the postal address', () => {
    for (const kind of ['ready', 'more', 'reminder'] as const) {
      const m = buildBoothMessage({ ...base, kind });
      expect(m.text).toContain(base.galleryUrl);
      expect(m.text).toContain(base.stopUrl);
      expect(m.html).toContain('?stop=1');
      for (const line of POSTAL_ADDRESS_LINES) expect(m.text).toContain(line);
    }
  });

  it('say what happened in the subject', () => {
    expect(buildBoothMessage({ ...base, kind: 'ready' }).subject).toBe('Your photos from Acme at CES are ready');
    expect(buildBoothMessage({ ...base, kind: 'more' }).subject).toBe('More of your photos from Acme at CES');
    expect(buildBoothMessage({ ...base, kind: 'reminder' }).text).toContain('removed on Sunday, February 7');
  });

  it('cannot be used to inject headers or HTML', () => {
    const m = buildBoothMessage({ ...base, kind: 'ready', eventName: 'Evil\r\nBcc: x@y.z <b>' });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).not.toContain('<b>');
  });

  it('use the business address from lib/businessInfo', () => {
    expect(POSTAL_ADDRESS_LINES).toEqual([...BUSINESS_ADDRESS_LINES]);
  });

  it('format the removal date in UTC', () => {
    expect(formatRemovalDate('2027-02-07T23:59:59.000Z')).toBe('Sunday, February 7');
    expect(formatRemovalDate(null)).toBeNull();
  });
});

describe('the delivery job', () => {
  const handler = codeOnly(readSource('amplify/functions/booth-deliveries/handler.ts'));

  it('sends nothing unless EMAIL_SENDING_ENABLED is on', () => {
    expect(handler).toMatch(/if \(!SENDING_ENABLED\) \{[\s\S]*?continue;/);
  });

  it('claims every email before sending it, and releases it on failure', () => {
    expect(handler.indexOf('claimDelivery(attendee, total, nowISO)')).toBeLessThan(
      handler.indexOf("send(attendee, event, delivery, total)"),
    );
    expect(handler).toContain('releaseDelivery(attendee, total)');
    expect(handler).toContain('releaseReminder(attendee)');
  });

  it('deletes only booth originals under pro/', () => {
    expect(handler).toContain("startsWith('pro/')");
    expect(handler).toContain("FilterExpression: 'attribute_exists(boothMatch)'");
  });

  it('lets only the event owner or an admin resend', () => {
    expect(mayManage({ sub: 'abc' }, 'abc::host@example.com')).toBe(true);
    expect(mayManage({ sub: 'ab' }, 'abc::host@example.com')).toBe(false);
    expect(mayManage({ sub: 'zzz', groups: ['ADMINS'] }, 'abc::host')).toBe(true);
    expect(mayManage(null, 'abc::host')).toBe(false);
  });

  it('is wired with delete rights only under pro/', () => {
    const backend = readSource('amplify/backend.ts');
    expect(backend).toContain("bucket.grantDelete(boothDeliveriesFn, 'pro/*')");
  });
});
