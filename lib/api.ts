// All Amplify calls live here so pages/components stay simple.
// Gen 2 / aws-amplify v6: typed data client + path-based storage.
import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
import { uploadData, getUrl, remove, downloadData } from 'aws-amplify/storage';
import JSZip from 'jszip';
import type { Schema } from '@/amplify/data/resource';
import {
  DiscountCode,
  DiscountRedemption,
  QREvent,
  QRPhoto,
  DisplayPhoto,
} from '@/lib/types';
import { buildPhotoKey, generateEventCode } from '@/lib/validation';
import { computeAccessExpiresAt, getTier } from '@/lib/pricing';

const client = generateClient<Schema>();

export interface CurrentUser {
  userId: string;
  /** Friendly name for display: the part of the email before @ */
  displayName: string;
  loginId: string | null;
}

/** Signed-in host info, or null for guests. */
export async function getCurrentUserInfo(): Promise<CurrentUser | null> {
  try {
    const user = await getCurrentUser();
    const loginId = user.signInDetails?.loginId ?? null;
    // Show "seth", not "seth@example.com", in public galleries.
    const displayName = loginId ? loginId.split('@')[0] : 'Host';
    return { userId: user.userId, displayName, loginId };
  } catch {
    return null;
  }
}

/** Guests use the identity pool; signed-in users use the user pool. */
async function authModeFor(): Promise<'userPool' | 'identityPool'> {
  return (await getCurrentUserInfo()) ? 'userPool' : 'identityPool';
}

export async function createNewEvent(input: {
  name: string;
  date?: string;
  tier: string;
}): Promise<QREvent> {
  const tier = getTier(input.tier);
  const user = await getCurrentUserInfo();

  const { data: event, errors } = await client.models.Event.create({
    name: input.name,
    date: input.date || null,
    tier: input.tier,
    eventCode: generateEventCode(),
    photoLimit: tier?.photoLimit ?? null,
    accessExpiresAt: computeAccessExpiresAt(input.tier),
    createdBy: user?.displayName ?? 'Unknown',
  });

  if (errors?.length || !event) {
    throw new Error('Event creation failed. Please try again.');
  }
  return event as QREvent;
}

export async function validateDiscountCode(
  code: string,
  tier: string,
): Promise<DiscountRedemption> {
  const { data, errors } = await client.queries.validateDiscountCode({
    code: code.trim().toUpperCase(),
    tier: tier.trim().toLowerCase(),
  });
  if (errors?.length || !data) {
    throw new Error('The access code could not be checked. Please try again.');
  }
  return data as DiscountRedemption;
}

export async function redeemDiscountCode(
  code: string,
  tier: string,
): Promise<DiscountRedemption> {
  const { data, errors } = await client.mutations.redeemDiscountCode({
    code: code.trim().toUpperCase(),
    tier: tier.trim().toLowerCase(),
  });
  if (errors?.length || !data) {
    throw new Error('The access code could not be redeemed. Please try again.');
  }
  return data as DiscountRedemption;
}

export async function listAllEvents(): Promise<QREvent[]> {
  const { data, errors } = await client.models.Event.list({
    limit: 1000,
    authMode: 'userPool',
  });
  if (errors?.length) throw new Error('Events could not be loaded.');
  return (data ?? []) as QREvent[];
}

export async function listAllPhotos(): Promise<QRPhoto[]> {
  const { data, errors } = await client.models.Photo.list({
    limit: 1000,
    authMode: 'userPool',
  });
  if (errors?.length) throw new Error('Photos could not be loaded.');
  return (data ?? []) as QRPhoto[];
}

export async function listDiscountCodes(): Promise<DiscountCode[]> {
  const { data, errors } = await client.models.DiscountCode.list({
    limit: 1000,
    authMode: 'userPool',
  });
  if (errors?.length) throw new Error('Discount codes could not be loaded.');
  return (data ?? []) as DiscountCode[];
}

export async function createDiscountCode(input: {
  code: string;
  assignedTo?: string;
  expiresAt: string;
  maxUses: number;
  createdBy?: string;
}): Promise<void> {
  const { errors } = await client.models.DiscountCode.create(
    {
      code: input.code.trim().toUpperCase(),
      assignedTo: input.assignedTo?.trim() || null,
      active: true,
      appliesToTier: 'standard',
      expiresAt: input.expiresAt,
      maxUses: input.maxUses,
      usedCount: 0,
      createdBy: input.createdBy ?? null,
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('Discount code could not be created.');
}

export async function setDiscountCodeActive(code: string, active: boolean): Promise<void> {
  const { errors } = await client.models.DiscountCode.update(
    { code, active },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('Discount code could not be updated.');
}

export async function deleteDiscountCode(code: string): Promise<void> {
  const { errors } = await client.models.DiscountCode.delete(
    { code },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('Discount code could not be removed.');
}

export async function deleteEventAsGlobalAdmin(eventId: string): Promise<void> {
  const { data: photos, errors: photoListErrors } = await client.models.Photo.listPhotoByEventId(
    { eventId },
    { limit: 1000, authMode: 'userPool' },
  );
  if (photoListErrors?.length) throw new Error('Event photos could not be loaded.');

  for (const photo of photos ?? []) {
    await remove({ path: photo.s3Key });
    const { errors } = await client.models.Photo.delete(
      { id: photo.id },
      { authMode: 'userPool' },
    );
    if (errors?.length) throw new Error('A photo record could not be removed.');
  }

  const { errors } = await client.models.Event.delete(
    { id: eventId },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The event could not be removed.');
}

export async function fetchEvent(eventId: string): Promise<QREvent | null> {
  const { data } = await client.models.Event.get(
    { id: eventId },
    { authMode: await authModeFor() }
  );
  return (data as QREvent) ?? null;
}

/**
 * Uploads one image to S3 and records its metadata.
 * Signed-in hosts are tagged with their name; guests are "Anonymous".
 * eventOwner is stamped so the host can moderate this photo later.
 */
export async function uploadEventPhoto(
  eventId: string,
  file: File,
  onProgress?: (p: { loaded: number; total: number }) => void,
  uploaderName?: string,
): Promise<QRPhoto> {
  const key = buildPhotoKey(eventId, file.name);
  const user = await getCurrentUserInfo();

  // The event carries its owner id, which we stamp onto the photo.
  const event = await fetchEvent(eventId);
  if (!event) throw new Error('This event no longer exists.');

  await uploadData({
    path: key,
    data: file,
    options: {
      contentType: file.type,
      onProgress: ({ transferredBytes, totalBytes }) => {
        if (totalBytes) {
          onProgress?.({ loaded: transferredBytes, total: totalBytes });
        }
      },
    },
  }).result;

  const { data: photo, errors } = await client.models.Photo.create(
    {
      eventId,
      s3Key: key,
      uploadedBy: user?.displayName ?? (uploaderName?.trim().slice(0, 60) || 'Anonymous'),
      uploadedByUserId: user?.userId ?? null,
      approved: true, // hosts can hide from the admin dashboard
      eventOwner: event.owner ?? null,
    },
    { authMode: await authModeFor() }
  );

  if (errors?.length || !photo) {
    throw new Error('Photo record could not be saved.');
  }
  return photo as QRPhoto;
}

/** Fetch photos for an event and resolve signed URLs for display. */
export async function fetchEventPhotos(
  eventId: string,
  opts: { includeUnapproved?: boolean } = {}
): Promise<DisplayPhoto[]> {
  const { data } = await client.models.Photo.listPhotoByEventId(
    { eventId },
    { limit: 500, authMode: await authModeFor() }
  );

  let photos = (data ?? []) as QRPhoto[];
  if (!opts.includeUnapproved) {
    photos = photos.filter((p) => p.approved !== false);
  }

  const withUrls = await Promise.all(
    photos.map(async (p) => {
      const { url } = await getUrl({ path: p.s3Key });
      return { ...p, url: url.toString() };
    })
  );

  return withUrls.sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  );
}

export async function setPhotoApproval(photoId: string, approved: boolean): Promise<void> {
  const { errors } = await client.models.Photo.update({ id: photoId, approved });
  if (errors?.length) throw new Error('Could not update the photo.');
}

/** Deletes the metadata record and the S3 object. */
export async function deleteEventPhoto(photo: QRPhoto): Promise<void> {
  const { errors } = await client.models.Photo.delete({ id: photo.id });
  if (errors?.length) throw new Error('Could not delete the photo record.');
  await remove({ path: photo.s3Key });
}

/** Triggers a browser download of a photo. */
export async function downloadPhoto(photo: QRPhoto): Promise<void> {
  const { body } = await downloadData({ path: photo.s3Key }).result;
  const blob = await body.blob();

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = photo.s3Key.split('/').pop() ?? 'photo.jpg';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

/** Creates one ZIP download from selected photos and videos. */
export async function downloadPhotosAsZip(
  photos: QRPhoto[],
  archiveName: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  if (photos.length === 0) throw new Error('Select at least one photo or video.');

  const zip = new JSZip();
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    const { body } = await downloadData({ path: photo.s3Key }).result;
    const blob = await body.blob();
    const originalName = photo.s3Key.split('/').pop() || `media-${index + 1}`;
    const numberedName = `${String(index + 1).padStart(3, '0')}-${originalName}`;
    zip.file(numberedName, blob);
    onProgress?.(index + 1, photos.length);
  }

  // Photos and videos are already compressed, so STORE is faster and uses less memory.
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = archiveName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'sharepix';
  link.href = blobUrl;
  link.download = `${safeName}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}
