import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import {
  confirmUserAttribute,
  fetchUserAttributes,
  updateUserAttributes,
} from 'aws-amplify/auth';
import Layout from '@/components/Layout';
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
      const attrs = await fetchUserAttributes();
      setCurrentEmail(attrs.email ?? '');
      setCurrentName(attrs.name ?? '');
      setName(attrs.name ?? '');
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
    const clean = sanitizeDisplayName(name);
    setSavingName(true);
    setNameNote(null);
    try {
      // An empty name clears the attribute, returning to the email-derived name.
      await updateUserAttributes({ userAttributes: { name: clean } });
      setCurrentName(clean);
      setName(clean);
      setNameNote({
        text: clean
          ? 'Saved. New events will show this name; it updates elsewhere next time you sign in.'
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
    <Layout title="Account">
      <section className="mx-auto max-w-xl py-10">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">Your account</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold">Account details</h1>
        <p className="mt-2 text-ink/70">
          Change the name shown on your events and the email address you sign in with.
        </p>

        {loading ? (
          <p className="mt-8 text-center text-ink/60">Loading your details…</p>
        ) : (
          <>
            {/* Display name */}
            <form onSubmit={handleSaveName} className="mt-6 rounded-2xl border border-ink/10 bg-white p-5">
              <h2 className="font-display text-xl font-bold">Display name</h2>
              <p className="mt-1 text-sm text-ink/65">
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
                className="mt-3 w-full rounded-xl border border-ink/20 px-4 py-2.5 outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={savingName || sanitizeDisplayName(name) === currentName}
                className="mt-3 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-night disabled:opacity-50"
              >
                {savingName ? 'Saving…' : 'Save name'}
              </button>
              {nameNote ? (
                <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${nameNote.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                  {nameNote.text}
                </p>
              ) : null}
            </form>

            {/* Email */}
            <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5">
              <h2 className="font-display text-xl font-bold">Email address</h2>
              <p className="mt-1 text-sm text-ink/65">
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
                    className="w-full rounded-xl border border-ink/20 px-4 py-2.5 outline-none focus:border-accent"
                  />
                  <button
                    type="submit"
                    disabled={emailBusy || !newEmail.trim()}
                    className="mt-3 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-night disabled:opacity-50"
                  >
                    {emailBusy ? 'Sending…' : 'Send confirmation code'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleConfirmEmail} className="mt-3 space-y-3">
                  <label htmlFor="email-code" className="text-sm font-medium">
                    Code sent to {newEmail.trim().toLowerCase()}
                  </label>
                  <input
                    id="email-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className="w-full rounded-xl border border-ink/20 px-4 py-3 text-center text-lg tracking-[0.35em] outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={emailBusy || !isCompleteCode(code)}
                      className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
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
                      className="rounded-full border border-ink/20 px-5 py-2.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {emailNote ? (
                <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${emailNote.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                  {emailNote.text}
                </p>
              ) : null}
            </div>

            {/* Deferred fields — said plainly rather than shown as dead inputs. */}
            <div className="mt-6 rounded-2xl border border-dashed border-ink/20 bg-white p-5 text-sm text-ink/65">
              <h2 className="font-display text-lg font-bold text-ink">Phone and mailing address</h2>
              <p className="mt-1">
                We don&apos;t collect these. Print orders take a delivery address at checkout each
                time, and we don&apos;t send texts — so there&apos;s nothing they&apos;d be used for
                yet. If you need them on your account, email{' '}
                <a href="mailto:info@sharepix.net" className="font-medium text-accent hover:underline">
                  info@sharepix.net
                </a>{' '}
                and tell us what for.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/account-security" className="rounded-full border border-ink/20 px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent">
                Password &amp; two-factor →
              </Link>
              <Link href="/my-events" className="rounded-full border border-ink/20 px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent">
                Back to your events
              </Link>
            </div>
          </>
        )}
      </section>
    </Layout>
  );
}

export default withAuthenticator(AccountPage);
