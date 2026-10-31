import { authModeFor, getClient } from '@/lib/dataClient';
import { LOG_CODES, isLogCode, supportCode, type LogCode, type LogDevice } from '@/lib/clientLogSchema';

/** One thing that happened on a device, with the time it happened. */
export interface DiagnosticEntry {
  /** Milliseconds before the batch was sent. Kept so a row can be shown as it arrived. */
  t: number;
  c: string;
  r?: string;
  d?: string;
  n?: number;
  /** ISO time it happened: when the server received the batch, minus `t`. */
  at: string;
}

/** One batch a device sent. */
export interface DiagnosticRow {
  id: string;
  receivedAt: string;
  deviceId: string;
  sessionId: string;
  build: string;
  device: LogDevice | null;
  entries: DiagnosticEntry[];
}

export interface DiagnosticPage {
  rows: DiagnosticRow[];
  nextToken: string | null;
}

export interface DiagnosticQuery {
  /** "account" reads the signed-in person's own account-level log instead of an event's. */
  scope?: 'event' | 'account';
  eventId?: string;
  /** A support code as a person typed it; it is cleaned up before use. */
  deviceCode?: string;
  nextToken?: string | null;
}

/** Reads what the diagnostics function returned, tolerating anything unexpected. */
export function parseDiagnostics(json: unknown): DiagnosticPage {
  const empty: DiagnosticPage = { rows: [], nextToken: null };
  if (typeof json !== 'string') return empty;
  try {
    const parsed = JSON.parse(json) as { rows?: unknown; nextToken?: unknown };
    const rows = Array.isArray(parsed.rows) ? (parsed.rows as DiagnosticRow[]) : [];
    return {
      rows: rows
        .filter((row) => row && typeof row === 'object')
        .map((row) => ({ ...row, entries: Array.isArray(row.entries) ? row.entries : [] })),
      nextToken: typeof parsed.nextToken === 'string' ? parsed.nextToken : null,
    };
  } catch {
    return empty;
  }
}

/** Fetch one page of logs. Throws when the call itself fails. */
export async function fetchDiagnostics(query: DiagnosticQuery): Promise<DiagnosticPage> {
  const { data, errors } = await getClient().queries.eventDiagnostics(
    {
      scope: query.scope ?? 'event',
      eventId: query.eventId,
      deviceCode: query.deviceCode || undefined,
      nextToken: query.nextToken || undefined,
      limit: 100,
    },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' \u00b7 '));
  return parseDiagnostics(data);
}

export interface DeviceSummary {
  deviceId: string;
  /** The code a guest reads out. */
  code: string;
  label: string;
  lastSeen: string;
  entryCount: number;
  problemCount: number;
}

/** Plain-language name of what a device was, from what it reported. */
export function deviceLabel(device: LogDevice | null | undefined): string {
  if (!device) return 'Unknown device';
  const parts = [device.app, device.b, device.os].filter((part): part is string => Boolean(part));
  const name = parts.length ? parts.join(' · ') : 'Unknown device';
  return device.w && device.h ? `${name} (${device.w}×${device.h})` : name;
}

/** Whether an entry is something that went wrong or is worth a second look. */
export function entryLevel(entry: Pick<DiagnosticEntry, 'c'>): 'info' | 'warn' | 'error' {
  return isLogCode(entry.c) ? LOG_CODES[entry.c as LogCode] : 'info';
}

/** One line per device, the ones with the most problems first. */
export function summarizeDevices(rows: DiagnosticRow[]): DeviceSummary[] {
  const byDevice = new Map<string, DeviceSummary>();
  for (const row of rows) {
    if (!row.deviceId) continue;
    const found =
      byDevice.get(row.deviceId) ??
      ({
        deviceId: row.deviceId,
        code: supportCode(row.deviceId),
        label: deviceLabel(row.device),
        lastSeen: row.receivedAt,
        entryCount: 0,
        problemCount: 0,
      } satisfies DeviceSummary);
    found.entryCount += row.entries.length;
    found.problemCount += row.entries.filter((entry) => entryLevel(entry) !== 'info').length;
    if (row.receivedAt > found.lastSeen) found.lastSeen = row.receivedAt;
    byDevice.set(row.deviceId, found);
  }
  return [...byDevice.values()].sort(
    (a, b) => b.problemCount - a.problemCount || b.lastSeen.localeCompare(a.lastSeen),
  );
}

export interface TimelineItem extends DiagnosticEntry {
  deviceId: string;
  code: string;
  sessionId: string;
}

/** Every entry from the given rows, oldest first, so a problem reads in order. */
export function buildTimeline(rows: DiagnosticRow[], deviceId?: string | null): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const row of rows) {
    if (deviceId && row.deviceId !== deviceId) continue;
    for (const entry of row.entries) {
      items.push({
        ...entry,
        deviceId: row.deviceId,
        code: row.deviceId ? supportCode(row.deviceId) : '',
        sessionId: row.sessionId,
      });
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  // A cell that starts with = + - or @ is read as a formula by spreadsheets.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The timeline as CSV, for a spreadsheet or for sending to support. */
export function timelineToCsv(items: TimelineItem[]): string {
  const header = ['time', 'support_code', 'session', 'event', 'level', 'route', 'detail', 'number'];
  const lines = items.map((item) =>
    [item.at, item.code, item.sessionId, item.c, entryLevel(item), item.r, item.d, item.n]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
