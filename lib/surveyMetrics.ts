/**
 * What SharePix already knows about an event, snapshotted onto a survey
 * response at the moment it is submitted.
 *
 * The point of building the survey into the product rather than renting a form
 * is that a host should not be asked things we can already see. So the response
 * carries the event's own numbers alongside the host's answers, and a reader in
 * a year's time gets both without having to hope the event row still agrees.
 *
 * ## Only what is measured
 *
 * `NOT_MEASURED_METRICS` names what this snapshot cannot contain, for the same
 * reason lib/monthlyReport.ts keeps its own list: a snapshot that reports
 * "gallery views: 0" for something nobody counts is worse than one that omits
 * it, because it makes every other figure on the page suspect. Storage is the
 * sharp case — `photoBytes` and `videoBytes` exist as fields and currently read
 * zero, because byte accounting has been off since the upload function lost its
 * table grants. Copying that zero in would record "this event used no storage",
 * which is false. It is omitted instead, and named below.
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
