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

/**
 * Where the abuse thresholds come from.
 *
 * They used to be round numbers with a sentence of intuition each. That was the
 * honest state to ship in when nothing was measured, but it turned out to put
 * the photo abuse threshold at 2.6x the point where a $79 event stops paying
 * for itself — an event could lose more than a hundred dollars before anything
 * stopped it.
 *
 * These are the inputs, so the thresholds below can be derived rather than
 * guessed. Figures come from docs/unit-economics.xlsx; the workbook is the
 * place to change an assumption and see the effect, this is the place the code
 * reads it from.
 *
 * `NET_REVENUE_USD` is $79 less Stripe fees and the expected Guest Upload
 * Promise refund. `COST_PER_GB_USD` is what one stored gigabyte costs over the
 * life of an event: R2 for ~17 months, the S3 copy for the 90-day repair
 * window, and the one-off egress charge for copying it to R2. `FIXED_COST_USD`
 * is compute, email and the expected research gift card.
 *
 * Duplicated into the Lambda copies of this file rather than imported, like
 * every other shared module here. A test pins them.
 */
export const UNIT_ECONOMICS = {
  netRevenueUsd: 74.04,
  // Rounded UP from the workbook's 0.4152, deliberately. A cost per gigabyte
  // that is too high produces a break-even that is too low and a threshold that
  // is too tight, which errs toward looking at an event sooner. Rounding the
  // other way errs toward paying for it.
  costPerGbUsd: 0.42,
  fixedCostUsd: 2.14,
} as const;

/**
 * Stored gigabytes at which one $79 event breaks even.
 *
 * The threshold that actually protects margin, because it does not depend on
 * guessing how large a photo is. `photoAbuseThreshold` is a proxy for this one
 * and inherits the error in the average-photo-size estimate, which is why the
 * byte threshold is set tighter relative to break-even than the count is.
 */
export const BREAK_EVEN_STORAGE_GB =
  (UNIT_ECONOMICS.netRevenueUsd - UNIT_ECONOMICS.fixedCostUsd) / UNIT_ECONOMICS.costPerGbUsd;

/**
 * How close to break-even an abuse threshold is allowed to sit.
 *
 * Not 1.0. A threshold exactly at break-even blocks an event the moment it
 * stops being profitable, and the whole posture of this file is that throttling
 * a real event is more expensive than absorbing an unusual one. 0.85 leaves the
 * loss bounded at nothing while keeping the block far above any real event.
 */
export const ABUSE_MARGIN = 0.85;

/**
 * Photos at which we start asking whether this is really an event.
 *
 * Not a cap. An event past this keeps accepting uploads exactly as before —
 * what changes is that it is flagged, the host is told they are unusually
 * large and invited to ask for more room, and the concentration rule below
 * gets a vote. The hard block stays at `photoAbuseThreshold`, which is where
 * the money actually runs out.
 *
 * Deliberately the same number as `photoReviewThreshold`: two different numbers
 * for "this is unusual" and "ask them about it" would drift apart, and there is
 * no case where you would want to flag an event to an admin and not tell the
 * host.
 */
export const CONCENTRATION_PHOTOS = 5_000;

/**
 * Photos per contributor above which an event stops looking like a party.
 *
 * A 300-guest wedding where a third of the room uploads produces perhaps twenty
 * photos each. Four hundred each is not a celebration; it is one device.
 */
export const MAX_PHOTOS_PER_CONTRIBUTOR = 400;

/**
 * ## Why concentration alone does not block
 *
 * The obvious rule is "5,000 photos and they all came from one account, so it
 * is not an event". It is the wrong rule, and the reason is worth writing down
 * because it will be proposed again.
 *
 * A host uploading their wedding photographer's gallery has `contributorCount`
 * of zero — host uploads are not guest uploads — and produces exactly the same
 * shape as somebody using a $79 plan as a backup drive. Blocking on
 * concentration alone refuses one of the more valuable things a host can do
 * with the product, on the same evidence that catches abuse.
 *
 * What separates them is HOW the files arrive. A photographer drags a folder
 * into a browser over minutes or hours. A script sustains machine rates. So
 * concentration is a flag on its own, and only becomes a block when it arrives
 * alongside a velocity that no person produces.
 *
 * Two weak signals agreeing is the strong one. Either alone is a false positive
 * waiting to refuse a paying customer mid-event.
 */
export function isConcentrated(facts: {
  photoCount?: number | null;
  contributorCount?: number | null;
}): boolean {
  const photos = Math.max(0, facts.photoCount ?? 0);
  if (photos < CONCENTRATION_PHOTOS) return false;
  const contributors = Math.max(0, facts.contributorCount ?? 0);
  // Zero contributors at this scale is the host-only case: flagged, never
  // blocked on this signal alone. Division would be by zero anyway.
  if (contributors === 0) return true;
  return photos / contributors > MAX_PHOTOS_PER_CONTRIBUTOR;
}

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
  // that and still obviously an event rather than an archive. Unchanged: this
  // one only flags, and it sits well below break-even, which is where a review
  // threshold should sit.
  photoReviewThreshold: 5_000,
  // Was 50,000, on the reasoning that "fifty thousand photos is not an event,
  // it is a migration". True, but it was also 2.6x the point where the event
  // stops paying for itself, so the migration got to run at our expense for a
  // long way first.
  //
  // Derived from BREAK_EVEN_STORAGE_GB at an assumed 4.05 MB per photo — the
  // original plus its preview and thumbnail. That average is an ESTIMATE, so
  // this number inherits its error; storageAbuseBytes below does not, and is
  // the one that actually protects margin.
  photoAbuseThreshold: Math.round(
    (BREAK_EVEN_STORAGE_GB * ABUSE_MARGIN * 1024) / 4.05 / 100,
  ) * 100,
  // At the 25 MB per-photo ceiling, 5,000 photos is 125 GB — but real phone
  // photos average nearer 4 MB, so a large event lands around 20 GB. Fifty is
  // well clear of a real event and still well below break-even.
  storageReviewBytes: 50 * GB,
  // Was 500 GB, which cost about $210 on a $79 event. This is the threshold
  // that does not depend on any estimate of photo size: whatever the files
  // are, this many stored bytes is what the money runs out at.
  storageAbuseBytes: Math.round(BREAK_EVEN_STORAGE_GB * ABUSE_MARGIN) * GB,
  // Video is the expensive half and the half whose cost is not bounded by
  // resizing, so it gets its own ceiling rather than being folded into total
  // storage where a thousand photos could mask it.
  //
  // Video is now SOLD as 10 GB rather than as a count of 30, so these sit
  // above the thing the customer was promised rather than below it. The old
  // 20 GB / 200 GB pair was dead config against a 7.5 GB plan ceiling; 6 GB
  // would have been worse, flagging events for using what they paid for.
  //
  // The gap between the 10 GB sold and the 12 GB flagged absorbs the overshoot
  // described on videoBytesLimit in lib/pricing.ts: bytes are only known once
  // an object has landed, so a burst of concurrent uploads can cross the line
  // by up to one file each.
  videoStorageReviewBytes: 12 * GB,
  videoStorageAbuseBytes: 20 * GB,
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
  /**
   * Distinct guests who uploaded. Feeds the concentration rule — see
   * isConcentrated for why it is a flag on its own and a block only alongside
   * machine-rate velocity.
   */
  contributorCount?: number | null;
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
  // Concentration AND machine-rate velocity, together.
  //
  // This is the auto-decline. Neither half blocks alone and that is the whole
  // design: concentration on its own is a host uploading their photographer's
  // gallery, and review-level velocity on its own is a busy reception. Arriving
  // together, at this volume, they are not either of those things.
  const concentrated = isConcentrated(facts);
  if (concentrated && perMinute >= config.velocityReviewPerMinute) {
    reasons.push(
      `${photos.toLocaleString()} photos from ${Math.max(0, facts.contributorCount ?? 0)} contributors at ${perMinute} a minute`,
    );
    blocked = true;
  }
  if (blocked) return { status: 'RESTRICTED', reasons, blocked: true };

  // Flagged, not blocked. The host is told they are unusually large and can
  // ask for more room; an admin can clear it with manualStatus NORMAL.
  if (concentrated) {
    reasons.push(
      `${photos.toLocaleString()} photos from ${Math.max(0, facts.contributorCount ?? 0)} contributors`,
    );
  }
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
