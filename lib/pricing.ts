export interface PricingTier {
  id: 'starter' | 'standard' | 'premium';
  name: string;
  price: number;
  photoLimit: number | null; // null = unlimited
  /**
   * How many videos the plan includes. Videos are capped separately from photos
   * because they are the only upload whose cost is not bounded by resizing: a
   * still is shrunk to a 1280px preview before it is ever served, while a video
   * streams from S3 at full size every time someone plays it. Counting videos
   * (rather than bytes) is the unit a host can understand, and the 250 MB
   * per-file ceiling is what bounds the bytes behind it.
   */
  videoLimit: number | null; // null = unlimited
  accessDays: number;
  accessLabel: string;
  // Lifecycle (all measured from when the 30-day upload window closes):
  // how long the HOST keeps full access + downloads before the event archives.
  retentionDays: number;
  // how long GUESTS keep low-resolution viewing before they see nothing.
  guestLowResDays: number;
  features: string[];
  highlight?: boolean;
}

// The upload window is the same on every plan; it can be extended in 30-day
// blocks for half the plan price.
export const UPLOAD_WINDOW_DAYS = 30;
export const EXTENSION_DAYS = 30;
// After the host-retention period ends, photos sit in a hidden, admin-only
// archive for this long before permanent deletion.
export const ARCHIVE_DAYS = 90;

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 19,
    photoLimit: 100,
    videoLimit: 2,
    accessDays: 14,
    accessLabel: '30-day upload window',
    retentionDays: 21,
    guestLowResDays: 21,
    features: [
      'Up to 100 photos and 2 videos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 3 weeks after uploads close; host access 3 weeks',
      'Standard QR code',
      'Host individual and bulk ZIP downloads (sign-in required)',
      'Guests can download the photos too — full resolution, no account',
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    price: 39,
    photoLimit: 1000,
    videoLimit: 10,
    accessDays: 90,
    accessLabel: '30-day upload window',
    retentionDays: 90,
    guestLowResDays: 30,
    highlight: true,
    features: [
      'Up to 1,000 photos and 10 videos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 30 days after uploads close; host access 3 months',
      'Customizable QR code',
      'Host individual and bulk ZIP downloads',
      'Guests can download the photos too — full resolution, no account',
      'Uploader names on photos',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 79,
    photoLimit: null,
    videoLimit: 30,
    accessDays: 365,
    accessLabel: '30-day upload window',
    retentionDays: 365,
    guestLowResDays: 30,
    features: [
      'Unlimited photos and 30 videos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 30 days after uploads close; host access 1 year',
      'Customizable QR code',
      'Event branding',
      'Moderation tools (approve before showing)',
      'Host photo, video, and bulk ZIP downloads',
      'Guests can download the photos too — full resolution, no account',
    ],
  },
];

export const CORPORATE_PLAN = {
  name: 'Corporate',
  price: 149, // USD per month
  interval: 'month' as const,
  priceLabel: '$149 / month',
  // Lifecycle for events created under a Corporate subscription (premium-like:
  // unlimited photos, 1-year host retention, 30-day guest low-res).
  retentionDays: 365,
  guestLowResDays: 30,
  // Photos are unlimited on corporate events, videos are not — see PricingTier.
  videoLimit: 30,
  accessLabel: 'Multiple events under one account',
  features: [
    'Multiple active events',
    'Unlimited photos and 30 videos per event',
    'Central event and storage dashboard',
    'Custom company branding',
    'Host and bulk ZIP downloads',
    'Guests can download the photos too — full resolution, no account',
    '30 days to download after your last paid month',
    'Priority support',
  ],
};

/**
 * One-time cost to turn on the live slideshow for a single event. Sold on every
 * plan, not just Corporate — it's the marquee wedding feature and the main
 * reason a couple upgrades, so gating it by tier would cost more sales than it
 * protects.
 */
export const LIVE_SLIDESHOW_ADDON_PRICE = 29;

export function getTier(id: string): PricingTier | undefined {
  return PRICING_TIERS.find((t) => t.id === id);
}

/**
 * Videos an event can still accept, or null when it has no limit. Used to tell
 * a guest before they pick a file; the real enforcement is the atomic
 * reservation in create-event-photo, which this only mirrors.
 */
export function videosRemaining(event: {
  videoLimit?: number | null;
  extraVideoCredits?: number | null;
  videoCount?: number | null;
}): number | null {
  if (event.videoLimit == null) return null; // pre-limit event, or unlimited
  const limit = event.videoLimit + (event.extraVideoCredits ?? 0);
  return Math.max(0, limit - (event.videoCount ?? 0));
}

/**
 * How many videos a new event on this tier includes, stamped onto the event at
 * creation so a later pricing change never retroactively blocks uploads to an
 * event someone already paid for.
 *
 * Corporate has no PricingTier row, so it is handled explicitly rather than
 * falling through to null — null means *unlimited*, which is exactly what a
 * video limit must never become by accident.
 */
export function videoLimitForTier(id: string): number | null {
  const tier = getTier(id);
  if (tier) return tier.videoLimit;
  return id === 'corporate' ? CORPORATE_PLAN.videoLimit : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Price to extend the upload window by 30 days: half the plan price (min $1). */
export function extensionPrice(tierId: string): number {
  const tier = getTier(tierId);
  return Math.max(1, Math.round((tier?.price ?? 20) / 2));
}

/**
 * Apply a percentage discount to a price, rounded to whole cents. `percentOff`
 * is clamped to 0–100, so 100 makes the price $0 (a fully comped purchase) and
 * anything out of range can't produce a negative or inflated total. This is the
 * display-side mirror of the discount the stripe-checkout function applies as a
 * Stripe coupon, so the price a host sees matches what they're charged.
 */
export function applyPercentOff(price: number, percentOff: number): number {
  const pct = Math.min(100, Math.max(0, percentOff));
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}

/**
 * Price after a discount code, for display. Mirrors what the checkout function
 * asks Stripe to charge, so the figure a host sees matches their card.
 *
 * A fixed amount is capped at the price (never negative) and rounded up to
 * cover the whole thing when the remainder would be too small for Stripe to
 * charge — the same rule the server applies.
 */
export function applyDiscount(
  price: number,
  discount: {
    discountType?: string | null;
    percentOff?: number | null;
    amountOffCents?: number | null;
  },
): number {
  if (discount.discountType === 'amount') {
    const off = Math.max(0, (discount.amountOffCents ?? 0) / 100);
    const remaining = Math.round((price - off) * 100) / 100;
    if (remaining <= 0 || remaining < 0.5) return 0;
    return remaining;
  }
  return applyPercentOff(price, discount.percentOff ?? 0);
}

/** When the initial 30-day upload window closes for a new event. */
export function computeUploadWindowEndsAt(from: Date = new Date()): string {
  return new Date(from.getTime() + UPLOAD_WINDOW_DAYS * DAY_MS).toISOString();
}

/** Compute the gallery expiry timestamp for a tier, starting now. */
export function computeAccessExpiresAt(tierId: string, from: Date = new Date()): string {
  const tier = getTier(tierId);
  // Corporate events (no per-event tier row) get the full upload window + host
  // retention so the displayed access date isn't the 14-day fallback.
  const days = tier
    ? tier.accessDays
    : tierId === 'corporate'
      ? UPLOAD_WINDOW_DAYS + CORPORATE_PLAN.retentionDays
      : 14;
  const expires = new Date(from.getTime() + days * DAY_MS).toISOString();
  return expires;
}
