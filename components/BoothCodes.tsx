import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Notice from '@/components/Notice';
import { boothCodes, type BoothCodesView } from '@/lib/api';

/**
 * The host's "Start & stop codes" (docs/booth-mode.md). Each code is signed
 * for this event by the server; the photographer photographs (or scans) one
 * to say where the following photos go. The codes are dividers: never in a
 * gallery, never emailed.
 */

const BTN = 'inline-flex min-h-[44px] items-center justify-center px-4 py-2 text-sm font-medium disabled:opacity-40';

export const HOW_IT_WORKS = [
  'Event start: photos after it go to the event photos (no one person).',
  'A person’s code: photos after it go to that person and are emailed to them once you approve them. Another person’s code switches to them.',
  'A category start (a day or session): photos after it go to that category.',
  'Stop: photos after it are kept but held, not sent, until the next start code. Scanning a person’s code while stopped carries on with that person.',
  'Once a person’s code has been scanned, they can add their own photos from their photo page until uploads close. Stop closes uploads; the next start code opens them again. “Close uploads” below keeps them closed until you reopen them.',
  'Every photo still waits for your approval in step 5, and you can fix the grouping in step 4.',
];

export default function BoothCodes({
  eventId,
  eventName,
  onCategories,
  initial,
}: {
  eventId: string;
  eventName?: string;
  onCategories?: (cats: { id: string; name: string }[]) => void;
  /** For tests and previews: skip loading. */
  initial?: BoothCodesView;
}) {
  const [view, setView] = useState<BoothCodesView | null>(initial ?? null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [newName, setNewName] = useState('');

  const act = useCallback(
    async (input: Parameters<typeof boothCodes>[0]) => {
      setWorking(true);
      try {
        const next = await boothCodes(input);
        setView(next);
        onCategories?.(next.categories);
        if (next.message) setNote({ ok: next.ok, text: next.message });
        return next.ok;
      } catch (err) {
        setNote({ ok: false, text: err instanceof Error ? err.message : 'That did not work. Try again.' });
        return false;
      } finally {
        setWorking(false);
      }
    },
    [onCategories],
  );

  useEffect(() => {
    if (initial) return;
    void act({ eventId, action: 'list' }).then(() => setNote((n) => (n?.ok ? null : n)));
  }, [eventId, act, initial]);

  return (
    <section id="booth-codes" className="spx-card scroll-mt-24 p-5 sm:p-6" aria-labelledby="booth-codes-title">
      <h2 id="booth-codes-title" className="font-sans text-xl font-bold tracking-[-0.02em]">
        Start &amp; stop codes
      </h2>
      <p className="spx-body mt-2 text-sm">
        Print these and keep them at the booth. Take a photo of a code (or scan it in the booth app) to tell
        SharePix where the next photos go. Code photos are only used for sorting and never sent or shown.
      </p>
      <details className="mt-3 text-sm">
        <summary className="min-h-[44px] cursor-pointer font-medium">How it works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-charcoal/85">
          {HOW_IT_WORKS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>

      {!view ? (
        <p className="mt-4 text-sm text-charcoal/70">Loading&hellip;</p>
      ) : (
        <>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CodeCard label="Event start" sub={eventName} value={view.eventCode} />
            <CodeCard label="Stop" sub={eventName} value={view.stopCode} />
            {view.categories.map((c) => (
              <CodeCard
                key={c.id}
                label={`Start: ${c.name}`}
                sub={eventName}
                value={c.code}
                onRename={(name) => act({ eventId, action: 'rename', categoryId: c.id, name })}
                working={working}
              />
            ))}
          </ul>

          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ eventId, action: 'add', name: newName }).then((ok) => ok && setNewName(''));
            }}
          >
            <label className="block flex-1 text-sm">
              <span className="font-medium">Add a category (a day or session)</span>
              <input
                value={newName}
                maxLength={40}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Saturday, or Morning session"
                className="spx-input mt-1 min-h-[44px] w-full text-base"
              />
            </label>
            <button type="submit" disabled={working || !newName.trim()} className={`spx-btn-ink ${BTN}`}>
              Add category
            </button>
          </form>

          <div className="mt-5 border-t border-charcoal/10 pt-4">
            <h3 className="text-base font-semibold">Guest uploads</h3>
            <p className="mt-1 text-sm text-charcoal/80">
              {view.uploadsClosed
                ? view.uploadsClosedBy === 'stop'
                  ? 'Closed by the stop code. The next start code opens them again.'
                  : 'Closed. Guests see “Uploads for this event are closed.”'
                : 'Open. People whose code was scanned can add their own photos. They wait for your approval.'}
            </p>
            <button
              type="button"
              disabled={working}
              onClick={() => void act({ eventId, action: view.uploadsClosed ? 'open' : 'close' })}
              className={`mt-2 border border-charcoal/30 ${BTN}`}
            >
              {view.uploadsClosed ? 'Reopen uploads' : 'Close uploads / Stop event'}
            </button>
          </div>
        </>
      )}
      {note ? (
        <Notice tone={note.ok ? 'success' : 'error'} className="mt-3">
          {note.text}
        </Notice>
      ) : null}
    </section>
  );
}

function CodeCard({
  label,
  sub,
  value,
  onRename,
  working,
}: {
  label: string;
  sub?: string;
  value: string | null;
  onRename?: (name: string) => Promise<boolean>;
  working?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.replace(/^Start: /, ''));
  const file = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'code';

  function svgMarkup(): string {
    return box.current?.querySelector('svg')?.outerHTML ?? '';
  }

  function print() {
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) return;
    w.document.write(
      `<!doctype html><title>${esc(label)}</title><body style="font-family:sans-serif;text-align:center;padding:40px">` +
        `<h1 style="font-size:40px;margin:0 0 8px">${esc(label)}</h1>` +
        (sub ? `<p style="font-size:20px;margin:0 0 24px">${esc(sub)}</p>` : '') +
        `<div style="width:420px;margin:0 auto">${svgMarkup().replace(/width="\d+"|height="\d+"/g, '')}</div>` +
        `<p style="font-size:14px;margin-top:24px">SharePix booth code. Photographed for sorting only; never sent.</p></body>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  function download() {
    const svg = svgMarkup();
    if (!svg) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 1040;
      const g = c.getContext('2d');
      if (!g) return;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#000';
      g.textAlign = 'center';
      g.font = 'bold 56px sans-serif';
      g.fillText(label, 450, 80, 860);
      if (sub) {
        g.font = '28px sans-serif';
        g.fillText(sub, 450, 125, 860);
      }
      g.drawImage(img, 90, 160, 720, 720);
      g.font = '22px sans-serif';
      g.fillText('SharePix booth code. For sorting only; never sent.', 450, 960, 860);
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = `sharepix-${file}.png`;
      a.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  return (
    <li className="border border-charcoal/20 p-3">
      <p className="text-base font-semibold">{label}</p>
      {value ? (
        <div ref={box} className="mx-auto mt-2 w-fit bg-white p-2">
          <QRCodeSVG value={value} size={148} level="M" includeMargin aria-label={`${label} QR code`} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-charcoal/70">Not available yet.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={!value} onClick={print} className={`border border-charcoal/30 ${BTN}`}>
          Print
        </button>
        <button type="button" disabled={!value} onClick={download} className={`border border-charcoal/30 ${BTN}`}>
          Download
        </button>
        {onRename ? (
          <button type="button" onClick={() => setEditing((e) => !e)} className={`underline ${BTN}`}>
            Rename
          </button>
        ) : null}
      </div>
      {editing && onRename ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onRename(name).then((ok) => ok && setEditing(false));
          }}
        >
          <input
            aria-label="Category name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className="spx-input min-h-[44px] flex-1 text-base"
          />
          <button type="submit" disabled={working || !name.trim()} className={`spx-btn-ink ${BTN}`}>
            Save
          </button>
        </form>
      ) : null}
      {onRename ? (
        <p className="mt-1 text-xs text-charcoal/65">Renaming keeps the same code, so printed copies still work.</p>
      ) : null}
    </li>
  );
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
