export interface QREvent {
  id: string;
  name: string;
  eventCode: string;
  date?: string | null;
  tier: string;
  photoLimit?: number | null;
  accessExpiresAt?: string | null;
  createdBy?: string | null;
  owner?: string | null;
  createdAt?: string;
}

export interface QRPhoto {
  id: string;
  eventId: string;
  s3Key: string;
  previewS3Key?: string | null;
  uploadedBy?: string | null;
  uploadedByUserId?: string | null;
  approved?: boolean | null;
  eventOwner?: string | null;
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
  expiresAt: string;
  maxUses: number;
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

export interface DiscountRedemption {
  valid: boolean;
  message?: string | null;
  code?: string | null;
  appliesToTier?: string | null;
  remainingUses?: number | null;
}
