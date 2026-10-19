/**
 * What the delivery job does for one attendee on one run. Pure, so the rules
 * are tested without DynamoDB or SES.
 */

export type DeliveryKind = 'ready' | 'more';

export interface AttendeeState {
  email: string | null;
  emailsStopped: boolean;
  deliveredCount: number;
  reminderSentAt: string | null;
}

/**
 * The delivery email due, if any. "ready" the first time any approved photo
 * exists; "more" when the count has grown since the last email. Never for an
 * attendee who stopped emails or has no address.
 */
export function deliveryDue(state: AttendeeState, approvedCount: number): DeliveryKind | null {
  if (!state.email || state.emailsStopped) return null;
  if (approvedCount <= state.deliveredCount) return null;
  return state.deliveredCount === 0 ? 'ready' : 'more';
}

/** Whether the download reminder is due: once, to people who were sent photos. */
export function reminderDue(
  state: AttendeeState,
  nowISO: string,
  reminderAtISO: string | null,
  removedAtISO: string | null,
): boolean {
  if (!state.email || state.emailsStopped) return false;
  if (state.deliveredCount === 0 || state.reminderSentAt) return false;
  if (!reminderAtISO || !removedAtISO) return false;
  return nowISO >= reminderAtISO && nowISO < removedAtISO;
}

/** Whether the event's originals should be removed now. */
export function removalDue(nowISO: string, removedAtISO: string | null, alreadyRemovedAt: string | null): boolean {
  return Boolean(removedAtISO && !alreadyRemovedAt && nowISO >= removedAtISO);
}
