import { FormEvent, useCallback, useEffect, useState } from 'react';
import { withAuthenticator } from '@aws-amplify/ui-react';
import {
  fetchMFAPreference,
  setUpTOTP,
  updateMFAPreference,
  verifyTOTPSetup,
} from 'aws-amplify/auth';
import { QRCodeCanvas } from 'qrcode.react';
import Layout from '@/components/Layout';

type SetupDetails = {
  secret: string;
  uri: string;
};

function AccountSecurityPage() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [preferred, setPreferred] = useState(false);
  const [setup, setSetup] = useState<SetupDetails | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPreference = useCallback(async () => {
    setLoading(true);
    try {
      const preference = await fetchMFAPreference();
      setEnabled(preference.enabled?.includes('TOTP') ?? false);
      setPreferred(preference.preferred === 'TOTP');
      setError(null);
    } catch {
      setError('We could not load your security settings. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreference();
  }, [loadPreference]);

  async function beginSetup() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const details = await setUpTOTP();
      setSetup({
        secret: details.sharedSecret,
        uri: details.getSetupUri('sharepix.net').toString(),
      });
    } catch {
      setError('We could not start MFA setup. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the six-digit code from your authenticator app.');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await verifyTOTPSetup({ code: code.trim() });
      await updateMFAPreference({ totp: 'PREFERRED' });
      setSetup(null);
      setCode('');
      setMessage('Authenticator-app MFA is now enabled for your account.');
      await loadPreference();
    } catch {
      setError('That code was not accepted. Wait for a new code and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateMFAPreference({ totp: 'DISABLED' });
      setSetup(null);
      setMessage('Authenticator-app MFA has been turned off.');
      await loadPreference();
    } catch {
      setError('We could not turn off MFA. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout title="Account security">
      <section className="mx-auto max-w-xl py-10">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">Your account</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold">Security</h1>
        <p className="mt-2 text-ink/70">
          Add a six-digit authenticator code after your password for stronger protection.
        </p>

        {error ? <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mt-5 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">{message}</p> : null}

        <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-bold">Authenticator-app MFA</h2>
              <p className="mt-1 text-sm leading-6 text-ink/65">
                Works with Google Authenticator, Microsoft Authenticator, 1Password, Authy, and similar apps.
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${enabled ? 'bg-green-100 text-green-800' : 'bg-ink/5 text-ink/60'}`}>
              {loading ? 'Checking…' : enabled ? 'Enabled' : 'Off'}
            </span>
          </div>

          {!loading && !enabled && !setup ? (
            <button
              type="button"
              onClick={beginSetup}
              disabled={busy}
              className="mt-5 w-full rounded-full bg-ink py-3 font-medium text-white hover:bg-night disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Set up MFA'}
            </button>
          ) : null}

          {setup ? (
            <div className="mt-6 border-t border-ink/10 pt-6">
              <ol className="space-y-5 text-sm text-ink/75">
                <li>
                  <strong className="text-ink">1. Scan this QR code</strong>
                  <div className="mt-3 flex justify-center rounded-xl bg-white p-4">
                    <QRCodeCanvas value={setup.uri} size={200} includeMargin />
                  </div>
                </li>
                <li>
                  <strong className="text-ink">2. Or enter this setup key manually</strong>
                  <code className="mt-2 block break-all rounded-lg bg-smoke px-3 py-2 text-center text-xs">
                    {setup.secret}
                  </code>
                </li>
                <li>
                  <strong className="text-ink">3. Confirm the six-digit code</strong>
                  <form onSubmit={confirmSetup} className="mt-2 space-y-3">
                    <label htmlFor="totp-code" className="sr-only">Authenticator code</label>
                    <input
                      id="totp-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      className="w-full rounded-xl border border-ink/20 px-4 py-3 text-center text-lg tracking-[0.35em] outline-none focus:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={busy || code.length !== 6}
                      className="w-full rounded-full bg-accent py-3 font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                    >
                      {busy ? 'Verifying…' : 'Verify and enable MFA'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSetup(null);
                        setCode('');
                      }}
                      disabled={busy}
                      className="w-full py-2 text-sm text-ink/60 hover:text-ink"
                    >
                      Cancel
                    </button>
                  </form>
                </li>
              </ol>
            </div>
          ) : null}

          {!loading && enabled && !setup ? (
            <div className="mt-5">
              <p className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">
                MFA is {preferred ? 'your preferred sign-in protection' : 'enabled'}.
              </p>
              <button
                type="button"
                onClick={disableMfa}
                disabled={busy}
                className="mt-4 w-full rounded-full border border-red-200 py-2.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {busy ? 'Updating…' : 'Turn off MFA'}
              </button>
            </div>
          ) : null}
        </div>

        <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          Keep access to your authenticator app. If you lose it, an administrator must reset MFA before you can sign in again.
        </p>
      </section>
    </Layout>
  );
}

export default withAuthenticator(AccountSecurityPage);
