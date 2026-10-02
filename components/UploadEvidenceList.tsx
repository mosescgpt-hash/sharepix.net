import { useState } from 'react';
import { listUploadEvidence, type UploadEvidenceRow } from '@/lib/api';

/**
 * Who uploaded an event's flagged photos, for an admin reviewing it.
 *
 * Loaded on request rather than with the dashboard: it is personal data
 * (network addresses), so it is fetched only when someone opens it for one
 * event. Admin-only by the table's authorization.
 */
export default function UploadEvidenceList({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<UploadEvidenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows === null) {
      try {
        setRows(await listUploadEvidence(eventId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Uploader details could not be loaded.');
        setRows([]);
      }
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={() => void toggle()} className="text-xs font-medium text-pine underline">
        {open ? 'Hide uploader details' : 'Uploader details for flagged photos'}
      </button>
      {open ? (
        <div className="mt-2 overflow-x-auto">
          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          {rows === null ? (
            <p className="text-xs text-charcoal/55">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-charcoal/55">
              No uploader details recorded. They are kept only for photos flagged after this
              feature shipped.
            </p>
          ) : (
            <table className="w-full min-w-[560px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-charcoal/15 text-charcoal/60">
                  <th scope="col" className="py-1.5 pr-3 font-medium">When (UTC)</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Uploader</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">IP address</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Account / identity</th>
                  <th scope="col" className="py-1.5 font-medium">Photo · reasons</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.photoId} className="border-b border-charcoal/5 align-top">
                    <td className="py-1.5 pr-3 font-mono">{row.recordedAt?.replace('T', ' ').slice(0, 19) ?? '—'}</td>
                    <td className="py-1.5 pr-3">{row.uploadedBy ?? '—'}</td>
                    <td className="py-1.5 pr-3 font-mono">{row.sourceIp ?? '—'}</td>
                    <td className="py-1.5 pr-3 font-mono break-all">{row.callerId ?? '—'}</td>
                    <td className="py-1.5 font-mono break-all">
                      {row.photoId}
                      {row.reasons ? <span className="font-sans text-charcoal/60"> · {row.reasons}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
