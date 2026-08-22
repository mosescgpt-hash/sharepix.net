import { sesSendHint } from '../amplify/functions/send-test-alert/hints';

describe('SES send hints', () => {
  it('reads the sandbox "not verified" error as a verification/sandbox issue, not a sender-region one', () => {
    // This is the exact shape SES raises about an unverified recipient in the
    // sandbox. The old hint wrongly blamed the sender's region.
    const detail =
      'Email address is not verified. The following identities failed the check in region US-EAST-1: guest@example.com';
    const hint = sesSendHint(detail);
    expect(hint).toMatch(/verify the recipient|production access/i);
    // It must not tell them to go re-verify the sending domain's region as the
    // primary fix.
    expect(hint).not.toMatch(/^.*verify the domain in the region/i);
  });

  it('still offers the region check as a secondary possibility', () => {
    const hint = sesSendHint('Email address is not verified.');
    expect(hint).toMatch(/per-region/i);
  });

  it('names the sandbox on an explicit sandbox error', () => {
    expect(sesSendHint('Account is in the sandbox')).toMatch(/production access/i);
    expect(sesSendHint('User is not authorized to send')).toMatch(/production access/i);
  });

  it('is empty for an error it has no specific advice for', () => {
    expect(sesSendHint('Throttling: rate exceeded')).toBe('');
    expect(sesSendHint('some unrelated failure')).toBe('');
  });
});
