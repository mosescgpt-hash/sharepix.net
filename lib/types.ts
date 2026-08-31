export interface QREvent {
  id: string;
  name: string;
  eventCode: string;
  date?: string | null;
  tier: string;
  /** "City, State" the host set for this event, if any. */
  location?: string | null;
  photoLimit?: number | null;
  extraPhotoCredits?: number | null;
  photoCount?: number | null;
  /** Videos included by the plan. Missing means unlimited (pre-limit events). */
  videoLimit?: number | null;
  extraVideoCredits?: number | null;
  videoCount?: number | null;
  accessExpiresAt?: string | null;
  uploadWindowEndsAt?: string | null;
  uploadsClosed?: boolean | null;
  paid?: boolean | null;
  guestDownloadEnabled?: boolean | null;
  liveSlideshowEnabled?: boolean | null;
  /** 'review' (default) holds flagged photos for the host; 'allow_all' skips screening. */
  moderationMode?: string | null;
  /** Where to email the host when a photo is held for review. */
  alertEmail?: string | null;
  /** False when the host has turned video uploads off. Missing means allowed. */
  videoUploadsEnabled?: boolean | null;
  createdBy?: string | null;
  owner?: string | null;
  createdAt?: string;
}

export interface QRPhoto {
  id: string;
  eventId: string;
  s3Key: string;
  previewS3Key?: string | null;
  thumbS3Key?: string | null;
  uploadedBy?: string | null;
  uploadedByUserId?: string | null;
  approved?: boolean | null;
  eventOwner?: string | null;
  contentHash?: string | null;
  /** 'ok' | 'flagged' | 'released' | 'skipped'; missing on pre-screening photos. */
  moderationStatus?: string | null;
  /** What the screener detected, when flagged. */
  moderationReasons?: string | null;
  createdAt?: string | null;
}

/** A photo joined with its resolved (signed) S3 URL for display. */
export interface DisplayPhoto extends QRPhoto {
  url: string;
}

export interface DiscountCode {
  code: string;
  assignedTo?: string | null;
  active: boolean;
  appliesToTier: string;
  /**
   * Which paid flows the code can be redeemed against: 'all', or a
   * comma-separated list of scope keys (event, corporate, extend,
   * guest_download). Missing on legacy codes — fall back to appliesToTier.
   */
  appliesToScopes?: string | null;
  /** 'percent' (default) or 'amount' for a fixed dollar discount. */
  discountType?: string | null;
  /** How much the code takes off, 1–100. Missing (legacy codes) means 100 (free). */
  percentOff?: number | null;
  /** Fixed discount in cents, used when discountType is 'amount'. */
  amountOffCents?: number | null;
  /** Corporate subscriptions only: 'once' (default) or 'forever'. */
  recurringDuration?: string | null;
  expiresAt: string;
  maxUses: number;
  /** When true the code never runs out; usedCount still counts redemptions. */
  unlimitedUses?: boolean | null;
  usedCount: number;
  lastUsedAt?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface DownloadShare {
  id: string;
  eventId: string;
  eventName: string;
  photoIds: string[];
  expiresAt?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
}

export interface CorporateSubscription {
  userId: string;
  email?: string | null;
  status?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  downloadGraceEndsAt?: string | null;
}

export interface DiscountRedemption {
  valid: boolean;
  message?: string | null;
  code?: string | null;
  appliesToTier?: string | null;
  discountType?: string | null;
  percentOff?: number | null;
  amountOffCents?: number | null;
  remainingUses?: number | null;
}
