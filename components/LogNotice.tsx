import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LOG_RETENTION_DAYS } from '@/lib/clientLogSchema';
import { getSupportCode, isLoggingOff, turnLoggingOff, turnLoggingOn } from '@/lib/clientLog';

/**
 * What the diagnostic log is, said where a guest can see it, with the way out.
 *
 * Shown under the upload form and the gallery rather than behind a banner: it is
 * information, not a consent gate, because the log holds nothing a person would
 * object to (no photos, names, messages or addresses). The way out is still one
 * tap, and Do Not Track is honoured without asking.
 *
 * Read in an effect, not during render: the answer lives in this browser's
 * storage, so the server-rendered page cannot know it.
 */
export default function LogNotice({ className = '' }: { className?: string }) {
  const [state, setState] = useState<{ off: boolean; code: string | null } | null>(null);

  useEffect(() => {
    const off = isLoggingOff();
    setState({ off, code: off ? null : getSupportCode() });
  }, []);

  if (!state) return null;

  function toggle() {
    if (state?.off) turnLoggingOn();
    else turnLoggingOff();
    const off = isLoggingOff();
    setState({ off, code: off ? null : getSupportCode() });
  }

  return (
    <p className={`text-xs leading-relaxed text-gray-500 ${className}`} data-testid="log-notice">
      {state.off ? (
        <>Diagnostic logs are off on this device. </>
      ) : (
        <>
          To fix problems, SharePix keeps short technical logs (your device type, connection and any
          errors, never your photos, name or messages) for {LOG_RETENTION_DAYS} days.
          {state.code ? (
            <>
              {' '}
              Support code <strong className="font-mono text-gray-700">{state.code}</strong>.
            </>
          ) : null}{' '}
        </>
      )}
      <button type="button" onClick={toggle} className="underline underline-offset-2">
        {state.off ? 'Turn logs on' : 'Turn off'}
      </button>
      {' · '}
      <Link href="/privacy#diagnostic-logs" className="underline underline-offset-2">
        Privacy
      </Link>
    </p>
  );
}
