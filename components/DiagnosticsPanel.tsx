import { useCallback, useMemo, useState } from 'react';
import {
  buildTimeline,
  entryLevel,
  fetchDiagnostics,
  summarizeDevices,
  timelineToCsv,
  type DiagnosticRow,
} from '@/lib/diagnostics';
import { LOG_RETENTION_DAYS, normalizeSupportCode } from '@/lib/clientLogSchema';

interface DiagnosticsPanelProps {
  eventId: string;
  eventName: string;
}

const LEVEL_STYLE = {
  info: 'text-charcoal/70',
  warn: 'text-amber-700',
  error: 'font-medium text-red-700',
} as const;

function formatTime(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString();
}

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The host's troubleshooting log for one event: which devices reported, what
 * happened on each, and a download to send to support.
 *
 * Nothing is fetched until the host asks. Most events never need this, and the
 * read costs a few cents of database time for a busy one.
 */
export default function DiagnosticsPanel({ eventId, eventName }: DiagnosticsPanelProps) {
  const [rows, setRows] = useState<DiagnosticRow[] | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(
    async (more: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const page = await fetchDiagnostics({
          eventId,
          deviceCode: normalizeSupportCode(code),
          nextToken: more ? nextToken : null,
        });
        setRows((current) => (more && current ? [...current, ...page.rows] : page.rows));
        setNextToken(page.nextToken);
      } catch {
        setError('We could not load the logs. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    },
    [eventId, code, nextToken],
  );

  const devices = useMemo(() => summarizeDevices(rows ?? []), [rows]);
  const timeline = useMemo(() => buildTimeline(rows ?? [], selected), [rows, selected]);
  const slug = eventName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event';

  return (
    <div id="troubleshooting" className="spx-card scroll-mt-24 mt-6 p-6" data-testid="diagnostics-panel">
      <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Troubleshooting log</h2>
      <p className="mt-2 text-sm text-charcoal/70">
        If a guest had trouble, this shows what their phone reported: pages opened, connection
        drops, and which step of an upload failed. It holds no photos, names or messages, and is
        kept for {LOG_RETENTION_DAYS} days. Ask the guest for the support code under the upload
        form to see just their phone.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSelected(null);
          void load(false);
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">Support code (optional)</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD-EFGH"
            maxLength={12}
            className="mt-1 block w-40 border border-ink/20 px-3 py-2 font-mono text-sm uppercase"
          />
        </label>
        <button type="submit" disabled={loading} className="spx-btn-outline disabled:opacity-50">
          {loading && !nextToken ? 'Loading…' : rows ? 'Refresh' : 'Show logs'}
        </button>
      </form>

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

      {rows && rows.length === 0 && !error ? (
        <p className="mt-4 text-sm text-charcoal/70">
          No logs yet{code ? ' for that code' : ''}. Devices send them while guests use the event pages.
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <>
          <ul className="mt-5 divide-y divide-ink/10 border border-ink/10" aria-label="Devices">
            {devices.map((device) => (
              <li key={device.deviceId}>
                <button
                  type="button"
                  onClick={() => setSelected(selected === device.deviceId ? null : device.deviceId)}
                  aria-pressed={selected === device.deviceId}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm ${
                    selected === device.deviceId ? 'bg-ink/5' : ''
                  }`}
                >
                  <span>
                    <span className="font-mono font-medium">{device.code}</span>{' '}
                    <span className="text-charcoal/70">{device.label}</span>
                  </span>
                  <span className="text-xs text-charcoal/70">
                    {device.problemCount > 0 ? (
                      <span className="font-medium text-red-700">
                        {device.problemCount} problem{device.problemCount === 1 ? '' : 's'}
                      </span>
                    ) : (
                      'no problems'
                    )}{' '}
                    · last {formatTime(device.lastSeen)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 max-h-96 overflow-auto border border-ink/10 p-3 font-mono text-xs" aria-label="Timeline">
            {timeline.length === 0 ? (
              <p>Nothing recorded.</p>
            ) : (
              timeline.map((item, index) => (
                <p key={`${item.at}-${index}`} className={LEVEL_STYLE[entryLevel(item)]}>
                  {formatTime(item.at)} · {item.code} · {item.c}
                  {item.r ? ` · ${item.r}` : ''}
                  {item.d ? ` · ${item.d}` : ''}
                  {item.n !== undefined ? ` · ${item.n}` : ''}
                </p>
              ))
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="spx-btn-outline"
              onClick={() => download(`${slug}-log.csv`, 'text/csv', timelineToCsv(timeline))}
            >
              Download CSV
            </button>
            <button
              type="button"
              className="spx-btn-outline"
              onClick={() =>
                download(
                  `${slug}-log.json`,
                  'application/json',
                  JSON.stringify(selected ? rows.filter((r) => r.deviceId === selected) : rows, null, 2),
                )
              }
            >
              Download JSON
            </button>
            {nextToken ? (
              <button type="button" className="spx-btn-outline" disabled={loading} onClick={() => void load(true)}>
                {loading ? 'Loading…' : 'Load older'}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
