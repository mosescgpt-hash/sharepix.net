import { useEffect, useState } from 'react';
import { getSupportCode, isLoggingOff, turnLoggingOff, turnLoggingOn } from '@/lib/clientLog';

/**
 * The privacy page's switch for diagnostic logs, on this device.
 *
 * Reads the browser's storage in an effect (the server-rendered page cannot know
 * it), and shows this device's support code while logging is on, so a guest who
 * is asked for it has somewhere to find it.
 */
export default function LogOptOut() {
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
    <p data-testid="log-opt-out">
      <strong>On this device, diagnostic logs are {state.off ? 'off' : 'on'}.</strong>{' '}
      {state.code ? (
        <>
          Support code: <code>{state.code}</code>.{' '}
        </>
      ) : null}
      <button type="button" onClick={toggle} className="underline underline-offset-2">
        {state.off ? 'Turn them on' : 'Turn them off and delete what is waiting here'}
      </button>
    </p>
  );
}
