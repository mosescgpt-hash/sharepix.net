import { useEffect, useRef, useState } from 'react';
import type { FreeEventDay } from '@/lib/quotaCounters';

/**
 * Free events per day for the last 30 days, against the limit each day ran
 * under. For one decision: is the daily limit too low?
 *
 * Columns, stacked: events given out, then requests the limit turned away on
 * top. The dashed step line is the limit — a threshold, which is the one thing
 * a dashed line is for. Plain SVG, no chart library, because the dashboard
 * has none and one chart does not justify adding one.
 *
 * Colors are the reference categorical slots 1 and 2, validated together on a
 * white surface (CVD ΔE 24.7). Text stays in the page's ink tokens; identity
 * comes from the swatches in the legend and the tooltip, never colored text.
 */

const GIVEN = '#2a78d6';
const REFUSED = '#eb6834';
const GRID = '#E7E3DC';
const INK_MUTED = '#5B6770';
const LIMIT_INK = '#152833';

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 32 };
const BAR_MAX = 18;

function niceMax(value: number): number {
  if (value <= 5) return 5;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * step >= value) return m * step;
  }
  return 10 * step;
}

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** A column segment with a 4px rounded top and a square bottom. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export default function FreeEventsChart({ series }: { series: FreeEventDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  // On a phone the chart scrolls sideways; start at the right, where today is.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [series.length]);
  if (series.length === 0) return null;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const top = niceMax(
    Math.max(1, ...series.map((d) => Math.max(d.given + d.refused, d.limit ?? 0))),
  );
  const slot = plotW / series.length;
  const barW = Math.min(BAR_MAX, slot - 4);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];

  // A quiet day records no limit, but it still ran under one: carry the last
  // known limit across it (and the first known one back over the start), so
  // the line does not break just because nobody asked that day.
  const firstKnown = series.find((d) => d.limit !== null)?.limit ?? null;
  let carried = firstKnown;
  const limits = series.map((d) => {
    if (d.limit !== null) carried = d.limit;
    return carried;
  });
  let limitPath = '';
  limits.forEach((limit, i) => {
    if (limit === null) return;
    const x0 = PAD.left + i * slot;
    const yy = y(limit);
    limitPath += limitPath ? ` L${x0},${yy} L${x0 + slot},${yy}` : `M${x0},${yy} L${x0 + slot},${yy}`;
  });

  const hovered = hover === null ? null : series[hover];

  return (
    <figure className="mt-4">
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-charcoal/70">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: GIVEN }} />
          Free events given out
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: REFUSED }} />
          Turned away by the limit
        </span>
        <span className="flex items-center gap-1.5">
          <svg aria-hidden width="18" height="6">
            <line x1="0" y1="3" x2="18" y2="3" stroke={LIMIT_INK} strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Daily limit
        </span>
      </figcaption>

      {/* Below ~560px the labels would shrink past reading, so the chart
          keeps its size and scrolls sideways inside this box instead. */}
      <div ref={scroller} className="mt-2 overflow-x-auto">
      <div className="relative min-w-[560px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full"
          role="img"
          aria-label="Free events per day for the last 30 days, with the daily limit. The table below has the same numbers."
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK_MUTED}>
                {Math.round(t).toLocaleString()}
              </text>
            </g>
          ))}

          {series.map((d, i) => {
            const cx = PAD.left + i * slot + slot / 2;
            const x = cx - barW / 2;
            const givenH = y(0) - y(d.given);
            const refusedH = y(0) - y(d.refused);
            // 2px of surface left between the stacked segments.
            const gap = d.given > 0 && d.refused > 0 ? 2 : 0;
            const faded = hover !== null && hover !== i;
            return (
              <g key={d.day} opacity={faded ? 0.45 : 1}>
                {d.given > 0 ? (
                  d.refused > 0 ? (
                    <rect x={x} y={y(d.given)} width={barW} height={givenH} fill={GIVEN} />
                  ) : (
                    <path d={topRounded(x, y(d.given), barW, givenH, 4)} fill={GIVEN} />
                  )
                ) : null}
                {d.refused > 0 ? (
                  <path
                    d={topRounded(x, y(d.given) - refusedH - gap, barW, Math.max(1, refusedH), 4)}
                    fill={REFUSED}
                  />
                ) : null}
                {i % 7 === series.length % 7 || i === series.length - 1 ? (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill={INK_MUTED}>
                    {i === series.length - 1 ? 'Today' : shortDate(d.day)}
                  </text>
                ) : null}
              </g>
            );
          })}

          {limitPath ? (
            <path
              d={limitPath}
              fill="none"
              stroke={LIMIT_INK}
              strokeWidth="2"
              strokeDasharray="5 4"
              strokeLinejoin="round"
            />
          ) : null}

          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke={INK_MUTED} strokeWidth="1" />

          {/* Hit targets: the whole column height, wider than the bar. */}
          {series.map((d, i) => (
            <rect
              key={`hit-${d.day}`}
              x={PAD.left + i * slot}
              y={PAD.top}
              width={slot}
              height={plotH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${shortDate(d.day)}: ${d.given} given out, ${d.refused} turned away${d.limit === null ? '' : `, limit ${d.limit}`}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>

        {hovered && hover !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 border border-charcoal/15 bg-paper px-3 py-2 text-xs text-charcoal shadow-sm"
            style={{
              left: `${Math.min(85, Math.max(15, ((PAD.left + hover * slot + slot / 2) / W) * 100))}%`,
            }}
          >
            <p className="font-semibold">{shortDate(hovered.day)}</p>
            <p className="mt-1 flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: GIVEN }} />
              {hovered.given} given out
            </p>
            <p className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: REFUSED }} />
              {hovered.refused} turned away
            </p>
            <p className="text-charcoal/60">
              {limits[hover] === null ? 'No limit recorded yet' : `Limit ${limits[hover]}`}
            </p>
          </div>
        ) : null}
      </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-charcoal/70">Show as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-charcoal/15 text-charcoal/60">
                <th scope="col" className="py-1.5 pr-3 font-medium">Day (UTC)</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Given out</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Turned away</th>
                <th scope="col" className="py-1.5 font-medium">Limit</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((d) => (
                <tr key={d.day} className="border-b border-charcoal/5">
                  <td className="py-1.5 pr-3">{d.day}</td>
                  <td className="py-1.5 pr-3">{d.given}</td>
                  <td className="py-1.5 pr-3">{d.refused}</td>
                  <td className="py-1.5">{d.limit ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
