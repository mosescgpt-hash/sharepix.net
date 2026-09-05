import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import {
  confirmUserAttribute,
  fetchUserAttributes,
  updateUserAttributes,
} from 'aws-amplify/auth';
import HostHeader from '@/components/HostHeader';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { getMyDisplayName, setMyDisplayName } from '@/lib/api';
import {
  isCompleteCode,
  sanitizeDisplayName,
  validateDisplayName,
  validateNewEmail,
} from '@/lib/account';

type Note = { text: string; ok: boolean } | null;

function AccountPage() {
  const [loading, setLoading] = useState(true);
  const [currentEmail, setCurrentEmail] = useState('');
  const [currentName, setCurrentName] = useState('');

  // Display name
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameNote, setNameNote] = useState<Note>(null);

  // Email change (two steps: request a code, then confirm it)
  const [newEmail, setNewEmail] = useState('');
  const [emailStage, setEmailStage] = useState<'idle' | 'confirm'>('idle');
  const [code, setCode] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<Note>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Email from Cognito (the login identity); display name from HostProfile.
      const [attrs, displayName] = await Promise.all([
        fetchUserAttributes(),
        getMyDisplayName(),
      ]);
      setCurrentEmail(attrs.email ?? '');
      setCurrentName(displayName);
      setName(displayName);
    } catch {
      setNameNote({ text: 'We could not load your account details. Try again.', ok: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveName(event: FormEvent) {
    event.preventDefault();
    const problem = validateDisplayName(name);
    if (problem) {
      setNameNote({ text: problem, ok: false });
      return;
    }
    setSavingName(true);
    setNameNote(null);
    try {
      // An empty name clears it, returning to the email-derived name.
      const clean = await setMyDisplayName(name);
      setCurrentName(clean);
      setName(clean);
      setNameNote({
        text: clean
          ? 'Saved. New events you create will show this name.'
          : 'Cleared. Your account will show the name from your email address again.',
        ok: true,
      });
    } catch (err) {
      setNameNote({
        text: err instanceof Error ? err.message : 'We could not save your name. Try again.',
        ok: false,
      });
    } finally {
      setSavingName(false);
    }
  }

  async function handleRequestEmail(event: FormEvent) {
    event.preventDefault();
    const problem = validateNewEmail(currentEmail, newEmail);
    if (problem) {
      setEmailNote({ text: problem, ok: false });
      return;
    }
    setEmailBusy(true);
    setEmailNote(null);
    try {
      const output = await updateUserAttributes({
        userAttributes: { email: newEmail.trim().toLowerCase() },
      });
      const step = output.email?.nextStep?.updateAttributeStep;
      if (step === 'CONFIRM_ATTRIBUTE_WITH_CODE') {
        setEmailStage('confirm');
        setEmailNote({
          text: `We sent a six-digit code to ${newEmail.trim().toLowerCase()}. Enter it below to finish.`,
          ok: true,
        });
      } else {
        // Some pools apply the change without a code.
        setCurrentEmail(newEmail.trim().toLowerCase());
        setNewEmail('');
        setEmailNote({ text: 'Your email address has been updated.', ok: true });
      }
    } catch (err) {
      setEmailNote({
        text: err instanceof Error ? err.message : 'We could not start the email change. Try again.',
        ok: false,
      });
    } finally {
      setEmailBusy(false);
    }
  }

  async function handleConfirmEmail(event: FormEvent) {
    event.preventDefault();
    if (!isCompleteCode(code)) {
      setEmailNote({ text: 'Enter the six-digit code from the email.', ok: false });
      return;
    }
    setEmailBusy(true);
    setEmailNote(null);
    try {
      await confirmUserAttribute({ userAttributeKey: 'email', confirmationCode: code.trim() });
      setCurrentEmail(newEmail.trim().toLowerCase());
      setNewEmail('');
      setCode('');
      setEmailStage('idle');
      setEmailNote({
        text: 'Your email address is updated. Use it to sign in from now on.',
        ok: true,
      });
    } catch (err) {
      setEmailNote({
        text: err instanceof Error ? err.message : 'That code was not accepted. Try again.',
        ok: false,
      });
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <Layout title="Account" width="bleed">
      <HostHeader
        eyebrow="Your account"
        title="Account details."
        serif="Name and sign-in."
        description="Change the name shown on your events and the email address you sign in with."
        current="account"
      />

      <section className="spx-section-canvas py-10 sm:py-14">
        <div className="mx-auto w-full max-w-xl">
        {loading ? (
          <p className="spx-body text-center">Loading your details&hellip;</p>
        ) : (
          <>
            {/* Display name */}
            <form onSubmit={handleSaveName} className="spx-card p-6">
              <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Display name</h2>
              <p className="mt-1 text-sm text-charcoal/60">
                Shown as the host on events you create. Leave it blank to use the name from your
                email address.
              </p>
              <label htmlFor="display-name" className="sr-only">Display name</label>
              <input
                id="display-name"
                type="text"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="Example: The Alvarez Wedding"
                className="spx-input mt-4"
              />
              <button
                type="submit"
                disabled={savingName || sanitizeDisplayName(name) === currentName}
                className="spx-btn-ink mt-4 px-6 py-3 text-sm disabled:opacity-50"
              >
                {savingName ? 'Saving…' : 'Save name'}
              </button>
              {nameNote ? (
                <Notice tone={nameNote.ok ? 'success' : 'error'} className="mt-4">
                  {nameNote.text}
                </Notice>
              ) : null}
            </form>

            {/* Email */}
            <div className="spx-card p-6">
              <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Email address</h2>
              <p className="mt-1 text-sm text-charcoal/60">
                You currently sign in with <strong className="text-ink">{currentEmail || 'an unknown address'}</strong>.
                Changing it sends a code to the new address to confirm it&apos;s yours.
              </p>

              {emailStage === 'idle' ? (
                <form onSubmit={handleRequestEmail} className="mt-3">
                  <label htmlFor="new-email" className="sr-only">New email address</label>
                  <input
                    id="new-email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="spx-input"
                  />
                  <button
                    type="submit"
                    disabled={emailBusy || !newEmail.trim()}
                    className="spx-btn-ink mt-4 px-6 py-3 text-sm disabled:opacity-50"
                  >
                    {emailBusy ? 'Sending…' : 'Send confirmation code'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleConfirmEmail} className="mt-3 space-y-3">
                  <label htmlFor="email-code" className="block text-sm font-medium text-charcoal">
                    Code sent to {newEmail.trim().toLowerCase()}
                  </label>
                  <input
                    id="email-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className="spx-input text-center text-lg tracking-[0.35em]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={emailBusy || !isCompleteCode(code)}
                      className="spx-btn-ink px-6 py-3 text-sm disabled:opacity-50"
                    >
                      {emailBusy ? 'Confirming…' : 'Confirm new email'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEmailStage('idle');
                        setCode('');
                        setNewEmail('');
                        setEmailNote(null);
                      }}
                      disabled={emailBusy}
                      className="spx-btn-outline px-6 py-3 text-sm disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {emailNote ? (
                <Notice tone={emailNote.ok ? 'success' : 'error'} className="mt-4">
                  {emailNote.text}
                </Notice>
              ) : null}
            </div>

            {/* Deferred fields — said plainly rather than shown as dead inputs. */}
            <div className="mt-6 border border-dashed border-charcoal/25 p-6 text-sm text-charcoal/65">
              <h2 className="font-sans text-lg font-semibold text-charcoal">
                Phone and mailing address
              </h2>
              <p className="mt-1">
                We don&apos;t collect these. Print orders take a delivery address at checkout each
                time, and we don&apos;t send texts — so there&apos;s nothing they&apos;d be used for
                yet. If you need them on your account, email{' '}
                <a href="mailto:info@sharepix.net" className="font-medium text-pine underline">
                  info@sharepix.net
                </a>{' '}
                and tell us what for.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/account-security" className="spx-btn-outline">
                Password &amp; two-factor &rarr;
              </Link>
              <Link href="/my-events" className="spx-btn-outline">
                Back to your events
              </Link>
            </div>
          </>
        )}
        </div>
      </section>
    </Layout>
  );
}

export default withAuthenticator(AccountPage);
