/**
 * The pure rules of booth sign-up, kept apart so they are tested directly.
 */

/** Sign-ups one event accepts. An abuse ceiling, not a product limit. */
export const MAX_ATTENDEES_PER_EVENT = 10000;

export const MAX_NAME_LENGTH = 80;
export const MAX_EMAIL_LENGTH = 254;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignupCheck =
  | { ok: true; name: string; email: string | null; phone: string | null; smsConsent: boolean }
  | { ok: false; reason: string };

/**
 * A cell number as E.164, or null when blank; throws on nonsense. Ten digits
 * are US/Canada. Same rule as lib/boothSeal.ts normalizePhone.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, '');
  let e164: string;
  if (text.startsWith('+')) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`;
  else throw new Error('Check the cell number — include the country code if it is not a US number.');
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) throw new Error('Check the cell number.');
  return e164;
}

/**
 * Name, contact and consent as the function will store them, or why not.
 * Email and/or a cell number — at least one. Each needs its own consent.
 */
export function validateSignup(input: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  consent?: boolean | null;
  smsConsent?: boolean | null;
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
  let phone: string | null;
  try {
    phone = normalizePhone(input.phone);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (email || !phone) {
    if (!EMAIL.test(email) || email.length > MAX_EMAIL_LENGTH) {
      return {
        ok: false,
        reason: phone
          ? 'Check the email address, or leave it blank to get a text instead.'
          : 'Enter the email address your photos should go to.',
      };
    }
    if (input.consent !== true) {
      return { ok: false, reason: 'Tick the box so we can email you your photos.' };
    }
  }
  if (phone && input.smsConsent !== true) {
    return { ok: false, reason: 'Tick the texting box, or leave the cell number blank.' };
  }
  return { ok: true, name, email: email || null, phone, smsConsent: Boolean(phone) };
}

/** What the host sees instead of the contact. Same as lib/boothSeal.ts contactLabel. */
export function maskedContact(email: string | null, phone: string | null): string {
  if (email) {
    const [user, domain] = email.split('@');
    return domain ? `${user.slice(0, 1)}***@${domain}` : '***';
  }
  if (phone) return `***-***-${phone.replace(/\D/g, '').slice(-4)}`;
  return 'Guest';
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
