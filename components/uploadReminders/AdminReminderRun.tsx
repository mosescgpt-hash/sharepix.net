import { useEffect, useState } from 'react';
import { runUploadReminders } from '@/lib/uploadReminders/api';

/**
 * Global admin: run the hourly guest reminder job now. The same code as the
 * schedule, so it sends exactly what is due — what the next hourly run would
 * have sent anyway.
 */
export default function AdminReminderRun() {
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    runUploadReminders(true)
      .then((r) => setStatus(r.summary))
      .catch(() => setStatus('Sending status unknown.'));
  }, []);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await runUploadReminders();
      setResult({ ok: r.ok, text: r.summary });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : 'The job could not be run.' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-4 border border-charcoal/10 p-4">
      <p className="text-sm font-semibold">Guest upload reminders (hourly)</p>
      <p className="mt-1 text-xs text-charcoal/60">
        {status ?? 'Checking…'} Sends only reminders that are due now, and deletes opt-ins 30 days
        after their event&apos;s uploads closed.
      </p>
      <button
        type="button"
        disabled={running}
        onClick={() => void run()}
        className="mt-2 border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
      >
        {running ? 'Running…' : 'Run reminders now'}
      </button>
      {result ? (
        <p className={`mt-2 text-sm ${result.ok ? 'text-green-700' : 'text-red-700'}`}>{result.text}</p>
      ) : null}
    </div>
  );
}
