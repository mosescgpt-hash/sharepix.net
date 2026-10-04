import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { stopUploadReminders } from '@/lib/uploadReminders/api';

/**
 * The unsubscribe link in a guest upload reminder. One click: opening the page
 * is the unsubscribe. No account, no confirmation step — the token in the link
 * is the credential, and the function checks it.
 */
export default function StopRemindersPage() {
  const router = useRouter();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (!router.isReady || ran.current) return;
    ran.current = true;
    const id = typeof router.query.r === 'string' ? router.query.r : '';
    const token = typeof router.query.t === 'string' ? router.query.t : '';
    stopUploadReminders(id, token).then((result) => {
      setState(result.ok ? 'done' : 'failed');
      setMessage(result.message);
    });
  }, [router.isReady, router.query.r, router.query.t]);

  return (
    <Layout title="Stop reminders">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-lg">
          {state === 'working' ? (
            <p className="spx-body text-center">Unsubscribing&hellip;</p>
          ) : state === 'done' ? (
            <Notice tone="success" label="Unsubscribed">
              {message}
            </Notice>
          ) : (
            <Notice tone="error">{message}</Notice>
          )}
        </div>
      </section>
    </Layout>
  );
}
