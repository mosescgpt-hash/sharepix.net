/**
 * Turn a raw SES send error into a one-line hint for the admin.
 *
 * Pure and separate so it can be unit tested — and because the previous inline
 * version was wrong: it read "Email address is not verified" (which SES raises
 * about the *recipient* in the sandbox) and blamed the *sender's region*,
 * sending people to re-verify a domain that was already fine.
 */
export function sesSendHint(detail: string): string {
  const d = detail.toLowerCase();

  // The sandbox / unverified-recipient case. SES phrases it as "Email address
  // is not verified. The following identities failed the check…". The real fix
  // is verify that address or leave the sandbox — NOT the sender's region.
  if (d.includes('not verified') || d.includes('not a verified')) {
    return (
      'SES would not send to that address. If your account is still in the SES ' +
      'sandbox, it only delivers to verified addresses — verify the recipient, ' +
      'or request production access to reach anyone. If you are already out of ' +
      'the sandbox, check that the sender (ALERT_FROM_ADDRESS) is a verified ' +
      'identity in this region — SES identities are per-region.'
    );
  }

  // Explicit sandbox / throttling authorization errors.
  if (d.includes('sandbox') || d.includes('not authorized to send')) {
    return 'The account is in the SES sandbox, which only delivers to verified addresses. Request production access.';
  }

  return '';
}
