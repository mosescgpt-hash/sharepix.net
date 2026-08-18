/**
 * Validation for the account-settings page.
 *
 * Pure functions, no Amplify imports, so the rules can be unit tested without a
 * user pool or database. The page/API do the actual writes (HostProfile for the
 * name, Cognito for the email); these just decide whether they should.
 */

// Control characters (CR/LF among them) have no place in a name, and are what
// enable header injection where a name is later placed in an email header.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Trim to what the stored display name should hold. */
export function sanitizeDisplayName(value: string): string {
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Why a display name can't be saved, or null when it's fine. An empty name is
 * allowed — it means "go back to the email-derived name", which the caller
 * handles by clearing the attribute.
 */
export function validateDisplayName(value: string): string | null {
  const clean = sanitizeDisplayName(value);
  if (clean.length > 60) return 'Keep your name to 60 characters or fewer.';
  return null;
}

/** Lowercase, trimmed — the form email compared against the current one. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Why a new email can't be requested, or null when it's fine. The format check
 * is deliberately simple — Cognito is the real validator, and it only accepts
 * the change once the code sent to the address is confirmed, so a typo can't
 * lock anyone out of the address they already have.
 */
export function validateNewEmail(current: string, next: string): string | null {
  const email = normalizeEmail(next);
  if (!email) return 'Enter your new email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'That doesn’t look like an email address.';
  }
  if (email === normalizeEmail(current)) {
    return 'That’s already the email on your account.';
  }
  return null;
}

/** Whether a six-digit confirmation code looks complete enough to submit. */
export function isCompleteCode(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}
