import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import {
  fetchMFAPreference,
  setUpTOTP,
  updateMFAPreference,
  verifyTOTPSetup,
} from 'aws-amplify/auth';
import { QRCodeCanvas } from 'qrcode.react';
import HostHeader from '@/components/HostHeader';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';

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
    <Layout title="Account security" width="bleed">
      <HostHeader
        eyebrow="Your account"
        title="Security."
        serif="One more step to sign in."
        description="Add a six-digit authenticator code after your password for stronger protection."
        current="security"
      />

      <section className="spx-section-canvas py-10 sm:py-14">
        <div className="mx-auto w-full max-w-xl">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {message ? (
          <Notice tone="success" className={error ? 'mt-4' : ''}>
            {message}
          </Notice>
        ) : null}

        <div className={`spx-card p-6 ${error || message ? 'mt-6' : ''}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">
                Authenticator-app MFA
              </h2>
              <p className="mt-1 text-sm leading-6 text-charcoal/60">
                Works with Google Authenticator, Microsoft Authenticator, 1Password, Authy, and similar apps.
              </p>
            </div>
            <span
              className={`shrink-0 px-3 py-1 font-sans text-[0.7rem] font-medium uppercase tracking-[0.14em] ${
                enabled ? 'bg-sage text-pine' : 'bg-charcoal/[0.07] text-charcoal/55'
              }`}
            >
              {loading ? 'Checking…' : enabled ? 'Enabled' : 'Off'}
            </span>
          </div>

          {!loading && !enabled && !setup ? (
            <button
              type="button"
              onClick={beginSetup}
              disabled={busy}
              className="spx-btn-ink mt-6 w-full disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Set up MFA'}
            </button>
          ) : null}

          {setup ? (
            <div className="mt-6 border-t border-charcoal/10 pt-6">
              <ol className="space-y-5 text-sm text-charcoal/75">
                <li>
                  <strong className="text-charcoal">1. Scan this QR code</strong>
                  <div className="mt-3 flex justify-center bg-paper p-4">
                    <QRCodeCanvas value={setup.uri} size={200} includeMargin />
                  </div>
                </li>
                <li>
                  <strong className="text-charcoal">2. Or enter this setup key manually</strong>
                  <code className="mt-2 block break-all bg-sand px-3 py-2 text-center text-xs">
                    {setup.secret}
                  </code>
                </li>
                <li>
                  <strong className="text-charcoal">3. Confirm the six-digit code</strong>
                  <form onSubmit={confirmSetup} className="mt-2 space-y-3">
                    <label htmlFor="totp-code" className="sr-only">Authenticator code</label>
                    <input
                      id="totp-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      className="spx-input text-center text-lg tracking-[0.35em]"
                    />
                    <button
                      type="submit"
                      disabled={busy || code.length !== 6}
                      className="spx-btn-ink w-full disabled:opacity-50"
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
                      className="w-full py-2 text-sm text-charcoal/60 transition hover:text-charcoal"
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
              <Notice tone="success" label="Protected">
                MFA is {preferred ? 'your preferred sign-in protection' : 'enabled'}.
              </Notice>
              <button
                type="button"
                onClick={disableMfa}
                disabled={busy}
                className="mt-4 w-full border border-red-300 py-3 font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
              >
                {busy ? 'Updating…' : 'Turn off MFA'}
              </button>
            </div>
          ) : null}
        </div>

        <Notice tone="warn" className="mt-6" label="Do not lose this">
          Keep access to your authenticator app. If you lose it, an administrator must reset MFA
          before you can sign in again.
        </Notice>

        <div className="mt-8">
          <Link href="/account" className="spx-btn-outline">
            &larr; Name &amp; email
          </Link>
        </div>
        </div>
      </section>
    </Layout>
  );
}

export default withAuthenticator(AccountSecurityPage);
