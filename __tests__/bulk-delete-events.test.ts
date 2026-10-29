import {
  BULK_DELETE_PHRASE,
  confirmsBulkDelete,
  deleteEventsOneByOne,
  eventCountLabel,
} from '../lib/bulkDeleteEvents';
import { codeOnly, readSource } from './sourceGuards';

describe('bulk delete of events', () => {
  it('needs the word DELETE, in any case', () => {
    expect(BULK_DELETE_PHRASE).toBe('DELETE');
    expect(confirmsBulkDelete('delete')).toBe(true);
    expect(confirmsBulkDelete('  Delete ')).toBe(true);
    expect(confirmsBulkDelete('')).toBe(false);
    expect(confirmsBulkDelete('del')).toBe(false);
    expect(confirmsBulkDelete('delete all')).toBe(false);
  });

  it('counts events in words', () => {
    expect(eventCountLabel(1)).toBe('1 event');
    expect(eventCountLabel(3)).toBe('3 events');
  });

  it('deletes one at a time, in order, and a failure does not stop the rest', async () => {
    const order: string[] = [];
    let running = 0;
    let overlap = false;
    const deleteOne = jest.fn(async (id: string) => {
      running += 1;
      if (running > 1) overlap = true;
      await Promise.resolve();
      order.push(id);
      running -= 1;
      if (id === 'b') throw new Error('A photo record could not be removed.');
    });
    const progress = jest.fn();
    const results = await deleteEventsOneByOne(['a', 'b', 'c', 'a'], deleteOne, progress);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(overlap).toBe(false);
    expect(results).toEqual([
      { id: 'a', ok: true, error: '' },
      { id: 'b', ok: false, error: 'A photo record could not be removed.' },
      { id: 'c', ok: true, error: '' },
    ]);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenLastCalledWith(3, 3, 'c', results[2]);
  });

  it('gives a plain message when a failure has none', async () => {
    const results = await deleteEventsOneByOne(['x'], async () => {
      throw new Error('');
    });
    expect(results[0]).toEqual({ id: 'x', ok: false, error: 'The event could not be deleted.' });
  });

  it('reuses the single-event delete: no second server path, no new mutation', () => {
    const page = codeOnly(readSource('pages/my-events.tsx'));
    expect(page).toContain('deleteEventsOneByOne(');
    expect(page).toContain('deleteEventWithPhotos,');
    const lib = codeOnly(readSource('lib/bulkDeleteEvents.ts'));
    expect(lib).not.toMatch(/mutations\.|models\./);
  });
});
