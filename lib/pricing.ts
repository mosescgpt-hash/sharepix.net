export interface PricingTier {
  id: 'starter' | 'standard' | 'premium';
  name: string;
  price: number;
  photoLimit: number | null; // null = unlimited
  accessDays: number;
  accessLabel: string;
  features: string[];
  highlight?: boolean;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: 10,
    photoLimit: 100,
    accessDays: 14,
    accessLabel: '2-week access',
    features: [
      'Up to 100 photos',
      'Gallery access for 2 weeks',
      'Standard QR code',
      'Photo downloads',
    ],
  },
  {
    id: 'standard',
    name: 'Standard',
    price: 25,
    photoLimit: 1000,
    accessDays: 90,
    accessLabel: '3-month access',
    highlight: true,
    features: [
      'Up to 1,000 photos',
      'Gallery access for 3 months',
      'Customizable QR code',
      'Photo downloads',
      'Uploader names on photos',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 50,
    photoLimit: null,
    accessDays: 365,
    accessLabel: '12-month access',
    features: [
      'Unlimited photos',
      'Gallery access for 12 months',
      'Customizable QR code',
      'Event branding',
      'Moderation tools (approve before showing)',
      'Photo downloads',
    ],
  },
];

export function getTier(id: string): PricingTier | undefined {
  return PRICING_TIERS.find((t) => t.id === id);
}

/** Compute the gallery expiry timestamp for a tier, starting now. */
export function computeAccessExpiresAt(tierId: string, from: Date = new Date()): string {
  const tier = getTier(tierId);
  const days = tier ? tier.accessDays : 14;
  const expires = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return expires.toISOString();
}
