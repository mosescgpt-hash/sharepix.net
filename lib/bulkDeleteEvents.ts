/**
 * Delete several of a host's events from My events.
 *
 * Nothing here deletes anything itself: each event goes through the same
 * function as the single "Delete event" button on its dashboard
 * (deleteEventWithPhotos), which removes the photos through the ownership-
 * checked deleteEventPhoto function and then the event through
 * removeHostedEvent (which refuses to destroy a closed or content-review
 * event and preserves its media instead). So the rules cannot drift between
 * the two buttons.
 */

export interface BulkDeleteResult {
  id: string;
  ok: boolean;
  /** Why it failed, in words for the host. Empty when ok. */
  error: string;
}

/** The word a host types to confirm a bulk delete. */
export const BULK_DELETE_PHRASE = 'DELETE';

/** Whether what they typed confirms it (case and surrounding spaces do not matter). */
export function confirmsBulkDelete(typed: string): boolean {
  return typed.trim().toUpperCase() === BULK_DELETE_PHRASE;
}

/**
 * Delete events one at a time (each can be thousands of photos, and a failure
 * in one must not stop or hide the others). Returns a result per id, in order.
 * Duplicate ids are deleted once.
 */
export async function deleteEventsOneByOne(
  ids: string[],
  deleteOne: (id: string) => Promise<void>,
  onProgress?: (done: number, total: number, id: string, result: BulkDeleteResult) => void,
): Promise<BulkDeleteResult[]> {
  const unique = [...new Set(ids)];
  const results: BulkDeleteResult[] = [];
  for (const id of unique) {
    let result: BulkDeleteResult;
    try {
      await deleteOne(id);
      result = { id, ok: true, error: '' };
    } catch (err) {
      result = {
        id,
        ok: false,
        error: err instanceof Error && err.message ? err.message : 'The event could not be deleted.',
      };
    }
    results.push(result);
    onProgress?.(results.length, unique.length, id, result);
  }
  return results;
}

/** "3 events", "1 event". */
export function eventCountLabel(count: number): string {
  return `${count} event${count === 1 ? '' : 's'}`;
}
