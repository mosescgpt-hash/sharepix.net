import { codeOnly, readSource } from './sourceGuards';

/**
 * Where the log is wired in, and what is never passed to it.
 *
 * The logger cleans what it is given, but the first defence is not handing it a
 * secret. These guard both: the places that must report, and the values that
 * must never be reported.
 */

const sites: Array<[string, string[]]> = [
  ['pages/event/[eventId]/live.tsx', ['live_start', 'live_start_fail', 'live_poll_fail', 'live_poll_recovered', 'live_paused', 'live_frame_unsignable', 'live_fullscreen']],
  ['lib/api.ts', ['upload_start', 'upload_ok', 'upload_fail', 'upload_retry']],
  ['lib/useMediaSource.ts', ['media_fallback']],
  ['pages/my-events.tsx', ['myevents_timeout', 'myevents_fail']],
];

describe('instrumented call sites', () => {
  it.each(sites)('%s reports its events', (path, codes) => {
    const source = codeOnly(readSource(path));
    expect(source).toContain("from '@/lib/clientLog'");
    for (const code of codes) expect(source).toContain(`logEvent('${code}'`);
  });

  it('_app starts the logger, records route changes and probes the guest session on event pages', () => {
    const app = codeOnly(readSource('pages/_app.tsx'));
    expect(app).toContain('startClientLog()');
    expect(app).toContain("router.events.on('routeChangeComplete', onRoute)");
    expect(app).toContain('logRouteView(url)');
    expect(app).toContain('eventIdFromPath(url)');
    expect(app).toContain('probeGuestSession()');
  });

  it('shows the guest notice on the upload and gallery pages, and the panel on the host admin page', () => {
    expect(readSource('pages/event/[eventId]/upload.tsx')).toContain('<LogNotice');
    expect(readSource('pages/event/[eventId]/index.tsx')).toContain('<LogNotice');
    expect(readSource('pages/event/[eventId]/admin.tsx')).toContain('<DiagnosticsPanel');
  });
});

describe('what is never handed to the logger', () => {
  const files = [...sites.map(([path]) => path), 'pages/_app.tsx'];

  it.each(files)('%s passes no address, link key or signed URL', (path) => {
    const calls = codeOnly(readSource(path)).match(/logEvent\([^;]*\);/g) ?? [];
    for (const call of calls) {
      expect(call).not.toMatch(/location|\.hash|href|signed|url|\.key|linkKey|photo\.|fileName|file\.name|\.message/i);
    }
  });
});
