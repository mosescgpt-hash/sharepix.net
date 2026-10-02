import {
  QUARANTINE_PREFIX,
  eventPrefix,
  quarantineKeyFor,
  quarantinePrefix,
  remapPhotoKeys,
  restoredKeyFor,
} from '../amplify/functions/event-takedown/quarantine';
import { codeOnly, readSource } from './sourceGuards';

/**
 * Closing an event is a full lock: media moves out of reach, nothing is
 * deleted, and neither the host nor a careless admin can remove the record.
 */

describe('the quarantine key mapping', () => {
  const live = 'events/ev1/photos/abc.jpg';

  it('moves a key under the quarantine prefix, keeping its path whole', () => {
    expect(quarantineKeyFor(live, 'ev1')).toBe(`quarantine/${live}`);
    expect(restoredKeyFor(`quarantine/${live}`, 'ev1')).toBe(live);
  });

  it('round-trips', () => {
    for (const key of [live, 'events/ev1/previews/abc.jpg', 'events/ev1/videos/clip.mp4']) {
      expect(restoredKeyFor(quarantineKeyFor(key, 'ev1') as string, 'ev1')).toBe(key);
    }
  });

  it('never touches another event’s keys, or a lookalike id', () => {
    expect(quarantineKeyFor('events/ev2/photos/x.jpg', 'ev1')).toBeNull();
    expect(quarantineKeyFor('events/ev10/photos/x.jpg', 'ev1')).toBeNull();
    expect(quarantineKeyFor('pro/ev1/x.jpg', 'ev1')).toBeNull();
    expect(quarantineKeyFor(live, '')).toBeNull();
    expect(restoredKeyFor('quarantine/events/ev2/photos/x.jpg', 'ev1')).toBeNull();
    expect(restoredKeyFor(live, 'ev1')).toBeNull();
  });

  it('lives outside events/, where browsers can read and the expiry rule applies', () => {
    expect(QUARANTINE_PREFIX.startsWith('events/')).toBe(false);
    expect(quarantinePrefix('ev1').startsWith(eventPrefix('ev1'))).toBe(false);
  });

  it('rewrites only the row fields that change, so a second run is a no-op', () => {
    const map = (key: string) => quarantineKeyFor(key, 'ev1');
    const row = { s3Key: live, previewS3Key: 'events/ev1/previews/abc.jpg', thumbS3Key: null };
    const once = remapPhotoKeys(row, map);
    expect(once).toEqual({
      s3Key: `quarantine/${live}`,
      previewS3Key: 'quarantine/events/ev1/previews/abc.jpg',
    });
    expect(remapPhotoKeys(once, map)).toEqual({});
  });
});

describe('who can read the quarantine', () => {
  const storage = codeOnly(readSource('amplify/storage/resource.ts'));

  it('is admins, read-only', () => {
    expect(storage).toContain("'quarantine/*': [allow.groups(['ADMINS']).to(['read'])]");
  });

  it('is nobody else', () => {
    const line = storage.slice(storage.indexOf("'quarantine/*'"));
    const rule = line.slice(0, line.indexOf(']') + 1);
    expect(rule).not.toContain('guest');
    expect(rule).not.toContain('authenticated');
  });
});

describe('the takedown function', () => {
  const fn = codeOnly(readSource('amplify/functions/event-takedown/handler.ts'));
  const schema = codeOnly(readSource('amplify/data/resource.ts'));

  it('is admin-only, in the schema and in the handler', () => {
    const decl = schema.slice(schema.indexOf('setEventTakedown: a'), schema.indexOf('deleteEventPhoto: a'));
    expect(decl).toContain("allow.group('ADMINS')");
    expect(decl).not.toContain('allow.authenticated');
    expect(fn).toContain("if (!groups.includes('ADMINS'))");
  });

  it('copies before it deletes, so an object is never in neither place', () => {
    const move = fn.slice(fn.indexOf('async function moveAll'), fn.indexOf('async function rewritePhotoRows'));
    expect(move.indexOf('new CopyObjectCommand')).toBeGreaterThan(-1);
    expect(move.indexOf('new CopyObjectCommand')).toBeLessThan(move.indexOf('new DeleteObjectCommand'));
  });

  it('hides the event before moving anything, and reopens it only after', () => {
    const body = fn.slice(fn.indexOf('export const handler'));
    const close = body.slice(0, body.indexOf('const toLive'));
    expect(close.indexOf('takenDownAt = if_not_exists')).toBeLessThan(close.indexOf('await moveAll('));
    const reopen = body.slice(body.indexOf('const toLive'));
    expect(reopen.indexOf('await moveAll(')).toBeLessThan(reopen.indexOf('REMOVE takenDownAt'));
  });

  it('drops R2 copies on close and keeps metadata on every copy', () => {
    expect(fn).toContain('moveAll(eventPrefix(eventId), toQuarantine, true, outOfTime)');
    expect(fn).toContain('moveAll(quarantinePrefix(eventId), toLive, false, outOfTime)');
    expect(fn).toContain("MetadataDirective: 'COPY'");
  });

  it('stops before the Lambda limit, so a large event finishes on a second press', () => {
    expect(fn).toContain('context.getRemainingTimeInMillis()');
    expect(readSource('amplify/functions/event-takedown/resource.ts')).toContain('timeoutSeconds: 900');
  });

  it('has the grants it needs', () => {
    const backend = codeOnly(readSource('amplify/backend.ts'));
    expect(backend).toContain('bucket.grantReadWrite(takedownFn)');
    expect(backend).toContain('bucket.grantDelete(takedownFn)');
    expect(backend).toContain('photoTable.grantReadWriteData(takedownFn)');
  });
});

describe('nobody can delete a closed event', () => {
  it('hosts lost the model delete, and go through a function instead', () => {
    const schema = codeOnly(readSource('amplify/data/resource.ts'));
    expect(schema).not.toContain("allow.ownerDefinedIn('owner').to(['get', 'list', 'delete'])");
    expect(codeOnly(readSource('lib/api.ts'))).toContain('getClient().mutations.removeHostedEvent(');
  });


  it('refuses photo deletes from a closed event for admins too', () => {
    const fn = codeOnly(readSource('amplify/functions/delete-event-photo/handler.ts'));
    const guard = fn.slice(fn.indexOf('const eventId = item.eventId?.S'));
    expect(guard).toContain('if (ev?.Item?.takenDownAt?.S)');
    expect(fn).not.toContain('if (!isAdmin) {\n    const eventId');
  });

  it('stops the admin delete button before it starts', () => {
    const admin = readSource('pages/global-admin.tsx');
    const handler = admin.slice(admin.indexOf('async function handleDeleteEvent'));
    expect(handler.indexOf('if (event.takenDownAt)')).toBeLessThan(handler.indexOf('deleteEventAsGlobalAdmin'));
  });
});

describe('a host removing a closed or flagged event', () => {
  const fn = codeOnly(readSource('amplify/functions/delete-event/handler.ts'));
  const main = fn.slice(fn.indexOf('export const handler'), fn.indexOf('async function preserve'));
  const preserve = fn.slice(fn.indexOf('async function preserve'));

  it('preserves it instead of deleting it', () => {
    expect(main).toContain('if (closed || flagged) {');
    expect(main.indexOf('await preserve(eventId, closed)')).toBeLessThan(main.indexOf('new DeleteItemCommand'));
    expect(preserve).not.toContain('DeleteItemCommand');
    expect(preserve).toContain('hostDeletedAt = :now');
  });

  it('still deletes an ordinary event, conditionally on it staying open', () => {
    expect(main).toContain("ConditionExpression: 'attribute_not_exists(takenDownAt)'");
    // A closure that lands in between is preserved, not deleted.
    expect(main).toContain('await preserve(eventId, true)');
  });

  it('closes an unclosed one quietly and starts the quarantine move', () => {
    expect(preserve).toContain('takedownQuiet = :true');
    expect(preserve).toContain("InvocationType: 'Event'");
    expect(preserve).toContain('arguments: { eventId, closed: true, quiet: true }');
    const backend = codeOnly(readSource('amplify/backend.ts'));
    expect(backend).toContain('takedownFn.grantInvoke(deleteEventFn)');
  });

  it('gives the host the same answer either way', () => {
    expect(fn.match(/return REMOVED;/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('takes it out of the host account, and only there', () => {
    const api = codeOnly(readSource('lib/api.ts'));
    expect(api).toContain('.filter((event) => !event.hostDeletedAt)');
    const dash = codeOnly(readSource('pages/event/[eventId]/admin.tsx'));
    expect(dash).toContain('if (ev.hostDeletedAt && !globalAdmin)');
    const admin = readSource('pages/global-admin.tsx');
    expect(admin).toContain('Removed by host');
  });

  it('is disclosed in the privacy policy', () => {
    const privacy = readSource('pages/privacy.tsx').replace(/\s+/g, ' ');
    expect(privacy).toContain('When a host removes an event, it is removed from their account.');
    expect(privacy).toContain('may be preserved for the same purposes rather than deleted');
  });
});
