// All Amplify calls live here so pages/components stay simple.
// Gen 2 / aws-amplify v6: typed data client + path-based storage.
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { uploadData, getUrl, downloadData } from 'aws-amplify/storage';
import JSZip from 'jszip';
import type { Schema } from '@/amplify/data/resource';
import {
  DiscountCode,
  DiscountRedemption,
  DownloadShare,
  QREvent,
  QRPhoto,
  DisplayPhoto,
} from '@/lib/types';
import { buildPhotoKey, buildPreviewKey, generateEventCode } from '@/lib/validation';
import { computeAccessExpiresAt, getTier } from '@/lib/pricing';
import { createPhotoPreview } from '@/lib/mediaPreview';

const client = generateClient<Schema>();
type DataAuthMode = 'userPool' | 'identityPool';

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
async function authModeFor(): Promise<DataAuthMode> {
  return (await getCurrentUserInfo()) ? 'userPool' : 'identityPool';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isTransientUploadError(error: unknown): boolean {
  return /rate exceeded|throttl|too many request|network|timeout|temporar|no current user|credential/i.test(
    errorMessage(error),
  );
}

async function retryTransient<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientUploadError(error) || attempt === attempts - 1) throw error;
      // Refresh credentials only when the session was lost; throttling needs quiet backoff instead.
      if (/no current user|credential/i.test(errorMessage(error))) {
        await fetchAuthSession({ forceRefresh: true }).catch(() => undefined);
      }
      const delay = 600 * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
  }
  throw lastError;
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

/** Return only events owned by the currently signed-in host. */
export async function listMyEvents(): Promise<QREvent[]> {
  const user = await getCurrentUserInfo();
  if (!user) throw new Error('Sign in to see your events.');

  const { data, errors } = await client.models.Event.list({
    limit: 1000,
    authMode: 'userPool',
  });
  if (errors?.length) throw new Error('Your events could not be loaded.');

  return ((data ?? []) as QREvent[])
    .filter((event) => event.owner?.includes(user.userId))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
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

/**
 * Starts a Stripe Checkout Session for a plan and returns the hosted-page URL.
 * The caller redirects the browser there; card details are entered on Stripe,
 * never in this app.
 */
export async function startCheckout(tier: string): Promise<string> {
  const { data, errors } = await client.mutations.createCheckoutSession(
    { tier: tier.trim().toLowerCase() },
    { authMode: 'userPool' },
  );
  if (errors?.length || !data?.url) {
    throw new Error('Checkout could not be started. Please try again.');
  }
  return data.url;
}

/**
 * Global-admin grant of extra photo capacity to one event (the pilot version of
 * the "buy more storage" add-on). `additionalCredits` is added to whatever the
 * event already has; the effective limit becomes photoLimit + extraPhotoCredits.
 */
export async function addEventPhotoCredits(
  eventId: string,
  additionalCredits: number,
): Promise<number> {
  const { data: existing, errors: readErrors } = await client.models.Event.get(
    { id: eventId },
    { authMode: 'userPool' },
  );
  if (readErrors?.length || !existing) throw new Error('The event could not be loaded.');

  const nextCredits = Math.max(0, (existing.extraPhotoCredits ?? 0) + additionalCredits);
  const { errors } = await client.models.Event.update(
    { id: eventId, extraPhotoCredits: nextCredits },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The photo capacity could not be updated.');
  return nextCredits;
}

export async function deleteEventAsGlobalAdmin(eventId: string): Promise<void> {
  const { data: photos, errors: photoListErrors } = await client.models.Photo.listPhotoByEventId(
    { eventId },
    { limit: 1000, authMode: 'userPool' },
  );
  if (photoListErrors?.length) throw new Error('Event photos could not be loaded.');

  for (const photo of photos ?? []) {
    // The function removes both the S3 objects and the record after an
    // ownership/admin check — clients can no longer delete S3 objects directly.
    const { data, errors } = await client.mutations.deleteEventPhoto(
      { photoId: photo.id },
      { authMode: 'userPool' },
    );
    if (errors?.length || !data?.success) throw new Error('A photo record could not be removed.');
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

export interface EventUploadContext {
  eventId: string;
  eventOwner: string | null;
  authMode: DataAuthMode;
  uploadedBy: string;
  uploadedByUserId: string | null;
}

/** Resolve auth, guest credentials, and the event once for an entire upload batch. */
export async function prepareEventUpload(
  eventId: string,
  uploaderName?: string,
): Promise<EventUploadContext> {
  let user = await getCurrentUserInfo();
  let authMode: DataAuthMode = user ? 'userPool' : 'identityPool';
  // Guests read the event through the identity pool's unauthenticated role. On a
  // fresh browser those credentials may not be minted on the first call, so a
  // guest request can go out unsigned and come back as
  // "Not Authorized to access getEvent on type Query". Force the session so the
  // very first read is signed with real guest credentials.
  await fetchAuthSession({ forceRefresh: authMode === 'identityPool' }).catch(() => undefined);

  const loadEvent = async (mode: DataAuthMode) => {
    const result = await client.models.Event.get({ id: eventId }, { authMode: mode });
    if (result.errors?.length) {
      throw new Error(result.errors.map((error) => error.message).join(' · '));
    }
    return result;
  };

  // A guest whose credentials weren't ready the first time: an authorization
  // failure here is usually a cold session rather than a real permission problem,
  // so mint fresh guest credentials and try again before giving up.
  const loadAsGuest = async () => {
    try {
      return await loadEvent('identityPool');
    } catch (error) {
      if (/not authoriz|unauthoriz|credential|no current user/i.test(errorMessage(error))) {
        await fetchAuthSession({ forceRefresh: true }).catch(() => undefined);
      }
      return retryTransient(() => loadEvent('identityPool'));
    }
  };

  let response: Awaited<ReturnType<typeof loadEvent>>;
  if (authMode === 'identityPool') {
    response = await loadAsGuest();
  } else {
    try {
      // Try once so a stale signed-in session can fall back to guest mode immediately.
      response = await loadEvent('userPool');
    } catch (error) {
      if (/no current user|unauthoriz|token/i.test(errorMessage(error))) {
        user = null;
        authMode = 'identityPool';
        response = await loadAsGuest();
      } else {
        response = await retryTransient(() => loadEvent('userPool'));
      }
    }
  }

  // A stale signed-in browser session should still be able to upload as a guest.
  if (!response.data && authMode === 'userPool') {
    user = null;
    authMode = 'identityPool';
    response = await loadAsGuest();
  }

  const event = response.data as QREvent | null;
  if (!event) throw new Error('This event no longer exists or cannot accept uploads.');

  return {
    eventId,
    eventOwner: event.owner ?? null,
    authMode,
    uploadedBy: user?.displayName ?? (uploaderName?.trim().slice(0, 60) || 'Anonymous'),
    uploadedByUserId: user?.userId ?? null,
  };
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
  const context = await prepareEventUpload(eventId, uploaderName);
  return uploadEventPhotoWithContext(context, file, onProgress);
}

export async function uploadEventPhotoWithContext(
  context: EventUploadContext,
  file: File,
  onProgress?: (p: { loaded: number; total: number }) => void,
): Promise<QRPhoto> {
  const { eventId } = context;
  const key = buildPhotoKey(eventId, file.name);
  const preview = await createPhotoPreview(file);
  const previewKey = preview ? buildPreviewKey(key) : null;

  await retryTransient(() =>
    uploadData({
      path: key,
      data: file,
      options: {
        contentType: file.type,
        onProgress: ({ transferredBytes, totalBytes }) => {
          if (totalBytes) onProgress?.({ loaded: transferredBytes, total: totalBytes });
        },
      },
    }).result,
  );

  if (preview && previewKey) {
    await retryTransient(() =>
      uploadData({
        path: previewKey,
        data: preview,
        options: { contentType: 'image/jpeg' },
      }).result,
    );
  }

  // Creation goes through the function so eventOwner is stamped from the event
  // and the photo limit is enforced server-side — the client can no longer set
  // ownership/approval or exceed the limit.
  const { data: photo } = await retryTransient(async () => {
    const result = await client.mutations.createEventPhoto(
      {
        eventId,
        s3Key: key,
        previewS3Key: previewKey ?? undefined,
        uploadedBy: context.uploadedBy,
        uploadedByUserId: context.uploadedByUserId,
      },
      { authMode: context.authMode },
    );
    if (result.errors?.length) {
      throw new Error(result.errors.map((error) => error.message).join(' · '));
    }
    return result;
  });

  if (!photo) {
    throw new Error('Photo record could not be saved.');
  }
  return photo as QRPhoto;
}

/** Fetch photos for an event and resolve signed URLs for display. */
export async function fetchEventPhotos(
  eventId: string,
  opts: { includeUnapproved?: boolean; useOriginals?: boolean } = {}
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
      const displayPath = opts.useOriginals ? p.s3Key : p.previewS3Key || p.s3Key;
      const { url } = await getUrl({ path: displayPath });
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

/** Deletes the S3 objects and the metadata record via an ownership-checked function. */
export async function deleteEventPhoto(photo: QRPhoto): Promise<void> {
  const { data, errors } = await client.mutations.deleteEventPhoto(
    { photoId: photo.id },
    { authMode: 'userPool' },
  );
  if (errors?.length || !data?.success) throw new Error('Could not delete the photo.');
}

export async function createDownloadShare(
  event: QREvent,
  requestedPhotoIds: string[],
): Promise<DownloadShare> {
  if (event.tier.toLowerCase() !== 'premium') {
    throw new Error('Download-sharing QR codes are available on Premium events.');
  }

  const user = await getCurrentUserInfo();
  if (!user || !event.owner?.includes(user.userId)) {
    throw new Error('Only the signed-in event host can create a download-sharing QR code.');
  }

  const { data: eventPhotos, errors: photoErrors } = await client.models.Photo.listPhotoByEventId(
    { eventId: event.id },
    { limit: 1000, authMode: 'userPool' },
  );
  if (photoErrors?.length) throw new Error('The event photos could not be checked.');

  const allowedIds = new Set(
    (eventPhotos ?? []).filter((photo) => photo.approved !== false).map((photo) => photo.id),
  );
  const photoIds = [...new Set(requestedPhotoIds)].filter((id) => allowedIds.has(id));
  if (photoIds.length === 0) throw new Error('Select at least one approved photo or video.');

  const { data, errors } = await client.models.DownloadShare.create(
    {
      eventId: event.id,
      eventName: event.name,
      photoIdsJson: JSON.stringify(photoIds),
      expiresAt: event.accessExpiresAt ?? null,
      createdBy: user.displayName,
    },
    { authMode: 'userPool' },
  );
  if (errors?.length || !data) throw new Error('The download-sharing QR code could not be created.');

  return {
    id: data.id,
    eventId: data.eventId,
    eventName: data.eventName,
    photoIds,
    expiresAt: data.expiresAt,
    createdBy: data.createdBy,
    createdAt: data.createdAt,
  };
}

export async function fetchDownloadShare(shareId: string): Promise<DownloadShare | null> {
  const { data, errors } = await client.models.DownloadShare.get(
    { id: shareId },
    { authMode: await authModeFor() },
  );
  if (errors?.length || !data) return null;

  try {
    const parsed = JSON.parse(data.photoIdsJson);
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) return null;
    return {
      id: data.id,
      eventId: data.eventId,
      eventName: data.eventName,
      photoIds: parsed,
      expiresAt: data.expiresAt,
      createdBy: data.createdBy,
      createdAt: data.createdAt,
    };
  } catch {
    return null;
  }
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
