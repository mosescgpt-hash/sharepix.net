export interface PricingTier {
  id: 'starter' | 'standard' | 'premium';
  name: string;
  price: number;
  photoLimit: number | null; // null = unlimited
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
    price: 10,
    photoLimit: 100,
    accessDays: 14,
    accessLabel: '30-day upload window',
    retentionDays: 21,
    guestLowResDays: 21,
    features: [
      'Up to 100 photos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 3 weeks after uploads close; host access 3 weeks',
      'Standard QR code',
      'Host individual and bulk ZIP downloads (sign-in required)',
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    price: 25,
    photoLimit: 1000,
    accessDays: 90,
    accessLabel: '30-day upload window',
    retentionDays: 90,
    guestLowResDays: 30,
    highlight: true,
    features: [
      'Up to 1,000 photos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 30 days after uploads close; host access 3 months',
      'Customizable QR code',
      'Host individual and bulk ZIP downloads',
      'Uploader names on photos',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 50,
    photoLimit: null,
    accessDays: 365,
    accessLabel: '30-day upload window',
    retentionDays: 365,
    guestLowResDays: 30,
    features: [
      'Unlimited photos',
      '30-day upload window (extend +30 days anytime)',
      'Guests view 30 days after uploads close; host access 1 year',
      'Customizable QR code',
      'Event branding',
      'Moderation tools (approve before showing)',
      'Host photo, video, and bulk ZIP downloads',
      'Guest download add-on available ($15/event)',
    ],
  },
];

export const CORPORATE_PLAN = {
  name: 'Corporate',
  price: 149, // USD per month
  interval: 'month' as const,
  priceLabel: '$149 / month',
  // One-time cost to enable guest downloads on a single corporate event
  // (guest downloads are off by default on corporate events).
  guestDownloadAddOnPrice: 15,
  accessLabel: 'Multiple events under one account',
  features: [
    'Multiple active events',
    'Central event and storage dashboard',
    'Guest downloads available per event ($15 each)',
    'Custom company branding',
    'Host and bulk ZIP downloads',
    '30 days to download after your last paid month',
    'Priority support',
  ],
};

export function getTier(id: string): PricingTier | undefined {
  return PRICING_TIERS.find((t) => t.id === id);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Price to extend the upload window by 30 days: half the plan price (min $1). */
export function extensionPrice(tierId: string): number {
  const tier = getTier(tierId);
  return Math.max(1, Math.round((tier?.price ?? 20) / 2));
}

/** When the initial 30-day upload window closes for a new event. */
export function computeUploadWindowEndsAt(from: Date = new Date()): string {
  return new Date(from.getTime() + UPLOAD_WINDOW_DAYS * DAY_MS).toISOString();
}

/** Compute the gallery expiry timestamp for a tier, starting now. */
export function computeAccessExpiresAt(tierId: string, from: Date = new Date()): string {
  const tier = getTier(tierId);
  const days = tier ? tier.accessDays : 14;
  const expires = new Date(from.getTime() + days * DAY_MS).toISOString();
  return expires;
}
