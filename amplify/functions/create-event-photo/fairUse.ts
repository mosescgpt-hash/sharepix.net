/**
 * What "unlimited" actually means, in one place.
 *
 * ## Why this file exists
 *
 * The plan is moving toward advertising unlimited photo uploads. Unlimited is a
 * real promise and this file is not a way of quietly breaking it — nothing here
 * caps a normal event, and the numbers below are deliberately far above what a
 * wedding, a conference or a school fundraiser could plausibly produce.
 *
 * What it does is make the difference between *a popular event* and *someone
 * using a $79 one-time purchase as a backup drive* something the system can
 * see. A large wedding legitimately producing four thousand photos and a script
 * uploading four thousand files in an hour look identical to a counter. They do
 * not look identical to these thresholds.
 *
 * ## The one rule
 *
 * **A threshold crossed here makes an event VISIBLE, not blocked.**
 *
 * `REVIEW` means a person should look. It changes nothing about the event and
 * the host is never told. Only `ABUSE_*` blocks, and those sit at levels no
 * real event reaches — the failure we are engineering against is throttling a
 * paying customer whose event went well, which is far more expensive than
 * letting an abusive event run one hour longer before a human sees it.
 *
 * ## Everything is configurable
 *
 * Every number is read through `fairUseConfig()`, which layers environment
 * overrides on top of the defaults. Nothing here should be copied into a
 * component, a handler or a condition expression — read the config.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface FairUseConfig {
  /** Photos in one event before a person should look. No effect on uploads. */
  photoReviewThreshold: number;
  /** Photos in one event that stop further uploads. Far above any real event. */
  photoAbuseThreshold: number;
  /** Stored bytes in one event before a person should look. */
  storageReviewBytes: number;
  /** Stored bytes in one event that stop further uploads. */
  storageAbuseBytes: number;
  /** Video bytes in one event before a person should look. */
  videoStorageReviewBytes: number;
  /** Video bytes in one event that stop further uploads. */
  videoStorageAbuseBytes: number;
  /** Uploads in one rolling minute before a person should look. */
  velocityReviewPerMinute: number;
  /** Uploads in one rolling minute that stop further uploads. */
  velocityAbusePerMinute: number;
  /** How long the velocity window is, in seconds. */
  velocityWindowSeconds: number;
}

/**
 * The defaults, and why each one is where it is.
 *
 * These are not tuned against real data, because there is none yet — every
 * number is a hypothesis with a stated reason, which is the honest state to
 * ship in. They are meant to be moved once real events exist.
 */
export const FAIR_USE_DEFAULTS: FairUseConfig = {
  // A 300-guest wedding where a third of the room contributes and each person
  // adds twenty photos lands near 2,000. Five thousand is comfortably past
  // that and still obviously an event rather than an archive.
  photoReviewThreshold: 5_000,
  // Fifty thousand photos is not an event. It is a migration.
  photoAbuseThreshold: 50_000,
  // At the 25 MB per-photo ceiling, 5,000 photos is 125 GB — but real phone
  // photos average nearer 3 MB, so a large event lands around 15 GB. Fifty is
  // well clear of a real event and well short of a bill worth worrying about.
  storageReviewBytes: 50 * GB,
  storageAbuseBytes: 500 * GB,
  // Video is the expensive half and the half whose cost is not bounded by
  // resizing, so it gets its own ceiling rather than being folded into total
  // storage where a thousand photos could mask it.
  videoStorageReviewBytes: 20 * GB,
  videoStorageAbuseBytes: 200 * GB,
  // A busy reception with fifty people uploading at once produces bursts. A
  // hundred and twenty a minute sustained does not come from thumbs.
  velocityReviewPerMinute: 120,
  // Twelve hundred a minute is twenty a second, which no room of humans does.
  velocityAbusePerMinute: 1_200,
  velocityWindowSeconds: 60,
};

function envNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  // A misconfigured override falls back rather than throwing: a bad env var
  // must not be able to set every threshold to zero and block every upload.
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * The thresholds in force, with environment overrides applied.
 *
 * Takes the environment as an argument rather than reading `process.env`
 * directly so the Lambda copies of this file and the tests can both drive it.
 */
export function fairUseConfig(env: Record<string, string | undefined> = {}): FairUseConfig {
  const d = FAIR_USE_DEFAULTS;
  return {
    photoReviewThreshold: envNumber(env.FAIR_USE_PHOTO_REVIEW, d.photoReviewThreshold),
    photoAbuseThreshold: envNumber(env.FAIR_USE_PHOTO_ABUSE, d.photoAbuseThreshold),
    storageReviewBytes: envNumber(env.FAIR_USE_STORAGE_REVIEW_BYTES, d.storageReviewBytes),
    storageAbuseBytes: envNumber(env.FAIR_USE_STORAGE_ABUSE_BYTES, d.storageAbuseBytes),
    videoStorageReviewBytes: envNumber(
      env.FAIR_USE_VIDEO_REVIEW_BYTES,
      d.videoStorageReviewBytes,
    ),
    videoStorageAbuseBytes: envNumber(env.FAIR_USE_VIDEO_ABUSE_BYTES, d.videoStorageAbuseBytes),
    velocityReviewPerMinute: envNumber(env.FAIR_USE_VELOCITY_REVIEW, d.velocityReviewPerMinute),
    velocityAbusePerMinute: envNumber(env.FAIR_USE_VELOCITY_ABUSE, d.velocityAbusePerMinute),
    velocityWindowSeconds: envNumber(env.FAIR_USE_VELOCITY_WINDOW, d.velocityWindowSeconds),
  };
}

/** What an event's usage looks like from the outside. */
export const USAGE_STATUSES = ['NORMAL', 'HIGH_USAGE', 'REVIEW', 'RESTRICTED'] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

export interface UsageFacts {
  photoCount?: number | null;
  videoCount?: number | null;
  photoBytes?: number | null;
  videoBytes?: number | null;
  derivedBytes?: number | null;
  /** Uploads counted in the current rolling window. */
  windowCount?: number | null;
  /** Set by an admin. Wins over anything computed. */
  manualStatus?: string | null;
}

/** Everything stored for an event, in bytes. */
export function totalBytes(facts: UsageFacts | null | undefined): number {
  if (!facts) return 0;
  return (
    Math.max(0, facts.photoBytes ?? 0) +
    Math.max(0, facts.videoBytes ?? 0) +
    Math.max(0, facts.derivedBytes ?? 0)
  );
}

export interface UsageAssessment {
  status: UsageStatus;
  /** Which thresholds were crossed, in plain words, for the admin list. */
  reasons: string[];
  /** True only when uploads should actually stop. */
  blocked: boolean;
}

/**
 * Where an event sits against the thresholds.
 *
 * `RESTRICTED` is the only status that blocks, and an admin setting it by hand
 * is the only way to reach it other than crossing an abuse threshold. A
 * `REVIEW` event uploads exactly as freely as a `NORMAL` one — the difference
 * is that somebody is told about it.
 */
export function assessUsage(
  facts: UsageFacts | null | undefined,
  config: FairUseConfig = FAIR_USE_DEFAULTS,
): UsageAssessment {
  const reasons: string[] = [];
  if (!facts) return { status: 'NORMAL', reasons, blocked: false };

  // An admin's decision wins over anything computed, in both directions. A
  // person who has looked at an event and judged it fine must be able to say
  // so without the thresholds arguing back every hour.
  if (facts.manualStatus === 'RESTRICTED') {
    return { status: 'RESTRICTED', reasons: ['Restricted by an admin'], blocked: true };
  }
  if (facts.manualStatus === 'NORMAL') {
    return { status: 'NORMAL', reasons: ['Cleared by an admin'], blocked: false };
  }

  const photos = Math.max(0, facts.photoCount ?? 0);
  const stored = totalBytes(facts);
  const video = Math.max(0, facts.videoBytes ?? 0);
  const perMinute = Math.max(0, facts.windowCount ?? 0);

  let blocked = false;
  if (photos >= config.photoAbuseThreshold) {
    reasons.push(`${photos.toLocaleString()} photos`);
    blocked = true;
  }
  if (stored >= config.storageAbuseBytes) {
    reasons.push(`${formatBytes(stored)} stored`);
    blocked = true;
  }
  if (video >= config.videoStorageAbuseBytes) {
    reasons.push(`${formatBytes(video)} of video`);
    blocked = true;
  }
  if (perMinute >= config.velocityAbusePerMinute) {
    reasons.push(`${perMinute} uploads a minute`);
    blocked = true;
  }
  if (blocked) return { status: 'RESTRICTED', reasons, blocked: true };

  if (photos >= config.photoReviewThreshold) reasons.push(`${photos.toLocaleString()} photos`);
  if (stored >= config.storageReviewBytes) reasons.push(`${formatBytes(stored)} stored`);
  if (video >= config.videoStorageReviewBytes) reasons.push(`${formatBytes(video)} of video`);
  if (perMinute >= config.velocityReviewPerMinute) {
    reasons.push(`${perMinute} uploads a minute`);
  }

  if (reasons.length === 0) return { status: 'NORMAL', reasons, blocked: false };
  // Two or more thresholds at once is the shape abuse actually has; one alone
  // is usually just a big event.
  return { status: reasons.length > 1 ? 'REVIEW' : 'HIGH_USAGE', reasons, blocked: false };
}

/** Bytes, for a person. Binary units, because that is what storage bills in. */
export function formatBytes(bytes: number | null | undefined): string {
  const value = Math.max(0, bytes ?? 0);
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < MB) return `${(value / 1024).toFixed(0)} KB`;
  if (value < GB) return `${(value / MB).toFixed(1)} MB`;
  return `${(value / GB).toFixed(2)} GB`;
}

/**
 * Whether a rolling velocity window has expired and should restart.
 *
 * The window is deliberately coarse: it resets rather than sliding, so a burst
 * straddling a boundary can briefly count as two smaller bursts. That
 * under-counts, which is the right direction to be wrong in when the
 * consequence of over-counting is refusing a real guest's photo.
 */
export function windowExpired(
  startedAt: string | null | undefined,
  now: Date,
  config: FairUseConfig = FAIR_USE_DEFAULTS,
): boolean {
  if (!startedAt) return true;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return true;
  return now.getTime() - started >= config.velocityWindowSeconds * 1000;
}

/**
 * The customer-facing footnote.
 *
 * Says what it needs to and no more. A fair-use notice that lists thresholds
 * makes a normal customer count their photos, which is exactly the anxiety
 * "unlimited" is meant to remove.
 */
export const FAIR_USE_NOTICE =
  'Unlimited photo uploads are for normal event use. SharePix may restrict automated uploads, bulk archival or backup use, and activity that is abusive or extraordinarily large.';
