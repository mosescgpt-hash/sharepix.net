/**
 * The Lambda's copy of the metrics snapshot.
 *
 * Byte-identical to lib/surveyMetrics.ts below the header; the drift guard is
 * in __tests__/survey-function-copy.test.ts. The snapshot is built here, from
 * the event row, so it records what SharePix measured rather than what a
 * browser claimed.
 */
/** What a snapshot cannot tell you, and why. Stored with every response. */
export const NOT_MEASURED_METRICS: readonly string[] = [
  'Storage used — byte accounting is not running, so the counters read zero rather than nothing',
  'QR scans — the code resolves to a page, and nothing counts the resolution',
  'Gallery and slideshow views — Cloudflare Web Analytics counts page views site-wide, not per event',
  'Upload failures — a failed upload creates no record, so there is nothing to count',
  'Support requests — no ticketing system',
];

/** The event fields a snapshot reads. All optional: older rows have gaps. */
export interface SnapshotSource {
  id?: string | null;
  name?: string | null;
  owner?: string | null;
  tier?: string | null;
  date?: string | null;
  eventType?: string | null;
  internalCohort?: string | null;
  createdAt?: string | null;
  paidAt?: string | null;
  paid?: boolean | null;
  /** Every media row on the event, videos included. */
  photoCount?: number | null;
  videoCount?: number | null;
  contributorCount?: number | null;
  guestUploadCount?: number | null;
  guestBookCount?: number | null;
  uploadWindowCount?: number | null;
}

export interface EventMetricsSnapshot {
  eventId: string;
  eventName: string;
  tier: string;
  eventDate: string | null;
  eventType: string | null;
  internalCohort: string | null;
  createdAt: string | null;
  paidAt: string | null;
  paid: boolean;
  /** Stills only: total media less videos. */
  photoCount: number;
  videoCount: number;
  /** Every uploaded item, which is what the event row actually counts. */
  totalMediaCount: number;
  contributorCount: number;
  guestUploadCount: number;
  guestBookCount: number;
  uploadWindowCount: number;
  /** When this snapshot was taken. */
  capturedAt: string;
  /** Copied in so a stored response explains its own gaps. */
  notMeasured: readonly string[];
}

function count(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Build the snapshot.
 *
 * `photoCount` on the event row counts every media item including videos (see
 * the field's comment in amplify/data/resource.ts), so stills are that total
 * less the video count — and never below zero, because the two counters are
 * maintained by different code paths and a corrected video count could in
 * principle overtake a stale total.
 */
export function buildMetricsSnapshot(
  event: SnapshotSource,
  capturedAt: Date = new Date(),
): EventMetricsSnapshot {
  const totalMediaCount = count(event.photoCount);
  const videoCount = count(event.videoCount);

  return {
    eventId: event.id ?? '',
    eventName: event.name ?? '',
    tier: event.tier ?? '',
    eventDate: event.date ?? null,
    eventType: event.eventType ?? null,
    internalCohort: event.internalCohort ?? null,
    createdAt: event.createdAt ?? null,
    paidAt: event.paidAt ?? null,
    // Missing means active, the same backward-compatible reading the rest of
    // the codebase gives this field.
    paid: event.paid !== false,
    photoCount: Math.max(0, totalMediaCount - videoCount),
    videoCount,
    totalMediaCount,
    contributorCount: count(event.contributorCount),
    guestUploadCount: count(event.guestUploadCount),
    guestBookCount: count(event.guestBookCount),
    uploadWindowCount: count(event.uploadWindowCount),
    capturedAt: capturedAt.toISOString(),
    notMeasured: NOT_MEASURED_METRICS,
  };
}

/** Read a stored snapshot back, or null if it is missing or unparseable. */
export function readMetricsSnapshot(json: string | null | undefined): EventMetricsSnapshot | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as EventMetricsSnapshot) : null;
  } catch {
    return null;
  }
}
