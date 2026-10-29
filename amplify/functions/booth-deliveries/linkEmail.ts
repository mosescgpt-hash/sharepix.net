/**
 * The rules for "email me my link" (docs/booth-mode.md, "Your link by email").
 * Pure, so they are tested without DynamoDB or SES.
 *
 * Two senders use them:
 *  - boothEmailMyLink: a guest taps Stop on /booth/capture, and the link to
 *    their personal page is emailed at once. The secret gallery key is the
 *    authorization; nothing here ever tells a caller about anyone else.
 *  - the prompt delivery: the host approves a photo, and the "ready" / "more"
 *    email goes out within a minute instead of at the next hourly run.
 */

/** A guest's link can be emailed this often at most … */
export const LINK_EMAIL_COOLDOWN_MS = 10 * 60 * 1000;
/** … and this many times in all for one person, whatever they do. */
export const MAX_LINK_EMAILS = 5;
/**
 * A prompt "more" email waits at least this long after the last delivery. A
 * host working through a queue should not send a guest one email per photo;
 * what is left over goes out at the next hourly run.
 */
export const MORE_COOLDOWN_MS = 10 * 60 * 1000;
/**
 * How long a prompt delivery waits before it counts. Approvals that land in
 * this window go out as one email ("3 photos"), not three.
 */
export const DELIVERY_SETTLE_MS = 60 * 1000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LENGTH = 254;

/** "j***@example.com". The same shape the host sees on the attendee list. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return null;
  return `${user.slice(0, 1)}***@${domain}`;
}

export type LinkEmailInput = { email?: string | null; consent?: boolean | null };

/** The address a guest typed, checked. Needs their tick: it is an email they asked for. */
export function checkLinkEmail(
  input: LinkEmailInput,
): { ok: true; email: string } | { ok: false; reason: string } {
  const email = (input.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, reason: 'Check the email address.' };
  }
  if (input.consent !== true) {
    return { ok: false, reason: 'Tick the box so we can email you your link.' };
  }
  return { ok: true, email };
}

export interface LinkEmailState {
  emailsStopped: boolean;
  linkEmailedAt: string | null;
  linkEmailCount: number;
}

/**
 * Why a link email must not go now, or null when it may. "stopped" is final;
 * "recent" and "limit" are quiet (the guest is told the link is on its way,
 * not that they are being limited).
 */
export function linkEmailRefusal(state: LinkEmailState, nowMs: number): 'stopped' | 'recent' | 'limit' | null {
  if (state.emailsStopped) return 'stopped';
  if (state.linkEmailCount >= MAX_LINK_EMAILS) return 'limit';
  if (state.linkEmailedAt) {
    const last = Date.parse(state.linkEmailedAt);
    if (Number.isFinite(last) && nowMs - last < LINK_EMAIL_COOLDOWN_MS) return 'recent';
  }
  return null;
}

/**
 * Whether a prompt delivery may send now. The first "ready" always may; a
 * "more" waits out MORE_COOLDOWN_MS from the last delivery (the hourly job
 * picks up the rest).
 */
export function promptDeliveryAllowed(
  kind: 'ready' | 'more',
  lastDeliveredAt: string | null,
  nowMs: number,
): boolean {
  if (kind === 'ready' || !lastDeliveredAt) return true;
  const last = Date.parse(lastDeliveredAt);
  return !Number.isFinite(last) || nowMs - last >= MORE_COOLDOWN_MS;
}
