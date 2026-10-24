/**
 * What the delivery job does for one attendee on one run. Pure, so the rules
 * are tested without DynamoDB, SES or SNS.
 */

export type DeliveryKind = 'ready' | 'more';

export interface AttendeeState {
  email: string | null;
  emailsStopped: boolean;
  deliveredCount: number;
  reminderSentAt: string | null;
  /** E.164 cell number, if they gave one. */
  phone?: string | null;
  /** They ticked the texting consent … */
  smsConsent?: boolean;
  /** … and have not replied STOP. */
  smsStopped?: boolean;
}

/** Whether email can go to this attendee. */
export function emailReachable(state: AttendeeState): boolean {
  return Boolean(state.email) && !state.emailsStopped;
}

/**
 * Whether a text can go to this attendee: a number, their consent, no STOP,
 * and texting switched on for the product (BOOTH_SMS_ENABLED).
 */
export function smsReachable(state: AttendeeState, smsEnabled: boolean): boolean {
  return smsEnabled && Boolean(state.phone) && state.smsConsent === true && state.smsStopped !== true;
}

function reachable(state: AttendeeState, smsEnabled: boolean): boolean {
  return emailReachable(state) || smsReachable(state, smsEnabled);
}

/**
 * Which channels a message goes out on. Texts go for the first "ready"
 * message and the reminder only: a text for every extra batch is too many.
 */
export function channelsFor(
  state: AttendeeState,
  kind: DeliveryKind | 'reminder',
  smsEnabled: boolean,
): { email: boolean; sms: boolean } {
  return { email: emailReachable(state), sms: kind !== 'more' && smsReachable(state, smsEnabled) };
}

/**
 * The delivery message due, if any. "ready" the first time any approved photo
 * exists; "more" when the count has grown since the last one. Never for an
 * attendee nobody can reach (stopped, or no address and no texting).
 */
export function deliveryDue(state: AttendeeState, approvedCount: number, smsEnabled = false): DeliveryKind | null {
  if (!reachable(state, smsEnabled)) return null;
  if (approvedCount <= state.deliveredCount) return null;
  const kind: DeliveryKind = state.deliveredCount === 0 ? 'ready' : 'more';
  const ch = channelsFor(state, kind, smsEnabled);
  return ch.email || ch.sms ? kind : null;
}

/** Whether the download reminder is due: once, to people who were sent photos. */
export function reminderDue(
  state: AttendeeState,
  nowISO: string,
  reminderAtISO: string | null,
  removedAtISO: string | null,
  smsEnabled = false,
): boolean {
  if (!reachable(state, smsEnabled)) return false;
  if (state.deliveredCount === 0 || state.reminderSentAt) return false;
  if (!reminderAtISO || !removedAtISO) return false;
  return nowISO >= reminderAtISO && nowISO < removedAtISO;
}

/** Whether the event's originals should be removed now. */
export function removalDue(nowISO: string, removedAtISO: string | null, alreadyRemovedAt: string | null): boolean {
  return Boolean(removedAtISO && !alreadyRemovedAt && nowISO >= removedAtISO);
}
