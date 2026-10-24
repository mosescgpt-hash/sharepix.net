/**
 * Who a booth photo goes to, and how the photographer's fix-ups change it
 * (docs/booth-mode.md, step 3). Pure, so the rules are tested directly.
 */

export interface Recipient {
  id: string;
  name: string;
}

/**
 * set    — this person only (a missed or wrong scan)
 * add    — this person as well (a group shot)
 * remove — not this person
 * clear  — nobody yet
 * divider — this photo is a QR code / divider shot: nobody, never delivered.
 *           (It does not read the code: only process-pro-photo can open an
 *           offline code. Any other action on it makes it a photo again.)
 */
export const ASSIGN_ACTIONS = ['set', 'add', 'remove', 'clear', 'divider'] as const;

/** Actions that need no person. */
export function actionNeedsTarget(action: AssignAction): boolean {
  return action !== 'clear' && action !== 'divider';
}

/** boothMatch after an action. */
export function matchAfter(action: AssignAction, recipients: number): string {
  if (action === 'divider') return 'divider';
  return recipients > 0 ? 'manual' : 'unassigned';
}
export type AssignAction = (typeof ASSIGN_ACTIONS)[number];

export function isAssignAction(value: unknown): value is AssignAction {
  return typeof value === 'string' && (ASSIGN_ACTIONS as readonly string[]).includes(value);
}

/** People one photo can go to. A large group shot, not a crowd. */
export const MAX_RECIPIENTS = 20;

/** Photos one fix-up may change at once. */
export const MAX_PHOTOS_PER_CALL = 100;

/** The recipients after an action. Order is kept; the first is the "main" one. */
export function applyAssignment(
  current: readonly Recipient[],
  action: AssignAction,
  target: Recipient | null,
): Recipient[] {
  if (action === 'clear' || action === 'divider') return [];
  if (!target) return [...current];
  if (action === 'set') return [target];
  if (action === 'remove') return current.filter((r) => r.id !== target.id);
  // add
  if (current.some((r) => r.id === target.id)) return [...current];
  if (current.length >= MAX_RECIPIENTS) return [...current];
  return [...current, target];
}

/**
 * The recipients stored on a photo row. Step 2 wrote a single
 * boothAttendeeId/Name; step 3 writes the lists. Both are read.
 */
export function recipientsOf(row: {
  ids?: readonly string[] | null;
  names?: readonly string[] | null;
  id?: string | null;
  name?: string | null;
}): Recipient[] {
  if (row.ids && row.ids.length > 0) {
    return row.ids.map((id, i) => ({ id, name: row.names?.[i] ?? 'Guest' }));
  }
  return row.id ? [{ id: row.id, name: row.name ?? 'Guest' }] : [];
}
