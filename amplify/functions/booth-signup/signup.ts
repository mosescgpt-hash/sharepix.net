/**
 * The pure rules of booth sign-up, kept apart so they are tested directly.
 */

/** Sign-ups one event accepts. An abuse ceiling, not a product limit. */
export const MAX_ATTENDEES_PER_EVENT = 5000;

export const MAX_NAME_LENGTH = 80;
export const MAX_EMAIL_LENGTH = 254;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignupCheck =
  | { ok: true; name: string; email: string }
  | { ok: false; reason: string };

/** Name, email and consent as the function will store them, or why not. */
export function validateSignup(input: {
  name?: string | null;
  email?: string | null;
  consent?: boolean | null;
}): SignupCheck {
  // Control characters out, whitespace collapsed: the name goes into emails
  // and onto the photographer's screen.
  // eslint-disable-next-line no-control-regex
  const name = (input.name ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  const email = (input.email ?? '').trim().toLowerCase();
  if (!name) return { ok: false, reason: 'Enter your name.' };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `Keep your name under ${MAX_NAME_LENGTH} characters.` };
  }
  if (!EMAIL.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, reason: 'Enter the email address your photos should go to.' };
  }
  if (input.consent !== true) {
    return { ok: false, reason: 'Tick the box so we can email you your photos.' };
  }
  return { ok: true, name, email };
}

/**
 * Whether an event is taking booth sign-ups, from its own row.
 *
 * Booth mode is a switch only an admin can turn on, so the client never says
 * whether an event is a booth; this reads it. A closed or removed event takes
 * no new sign-ups.
 */
export function boothOpen(ev: {
  boothMode?: boolean | null;
  paid?: boolean | null;
  takenDownAt?: string | null;
  hostDeletedAt?: string | null;
}): boolean {
  if (ev.boothMode !== true) return false;
  if (ev.paid === false) return false;
  if (ev.takenDownAt || ev.hostDeletedAt) return false;
  return true;
}
