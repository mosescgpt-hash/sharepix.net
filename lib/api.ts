// All Amplify calls live here so pages/components stay simple.
// Gen 2 / aws-amplify v6: typed data client + path-based storage.
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { uploadData, getUrl, downloadData, getProperties } from 'aws-amplify/storage';
import JSZip from 'jszip';
import type { Schema } from '@/amplify/data/resource';
import {
  CorporateSubscription,
  DiscountCode,
  DiscountRedemption,
  DownloadShare,
  QREvent,
  QRPhoto,
  DisplayPhoto,
} from '@/lib/types';
import { buildPhotoKey, buildPreviewKey, buildThumbKey, generateEventCode } from '@/lib/validation';
import {
  computeAccessExpiresAt,
  computeUploadWindowEndsAt,
  getTier,
  videoLimitForTier,
} from '@/lib/pricing';
import { createPhotoPreview, createPhotoThumb } from '@/lib/mediaPreview';

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
  /** true = paid/comped and active now; false = pending until the webhook activates it. */
  paid?: boolean;
}): Promise<QREvent> {
  const tier = getTier(input.tier);
  const user = await getCurrentUserInfo();

  const { data: event, errors } = await client.models.Event.create({
    name: input.name,
    date: input.date || null,
    tier: input.tier,
    eventCode: generateEventCode(),
    photoLimit: tier?.photoLimit ?? null,
    videoLimit: videoLimitForTier(input.tier),
    accessExpiresAt: computeAccessExpiresAt(input.tier),
    uploadWindowEndsAt: computeUploadWindowEndsAt(),
    paid: input.paid ?? true,
    createdBy: user?.displayName ?? 'Unknown',
  });

  if (errors?.length || !event) {
    const detail = errors?.map((e) => e.message).join(' · ');
    throw new Error(detail || 'Event creation failed. Please try again.');
  }
  return event as QREvent;
}

/** Delete one of the current host's own events (used to cancel an unpaid one). */
export async function deleteMyEvent(eventId: string): Promise<void> {
  const { errors } = await client.models.Event.delete(
    { id: eventId },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The event could not be removed.');
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
  /** 'percent' (default) or 'amount' for a fixed dollar discount. */
  discountType?: 'percent' | 'amount';
  /** 1–100. 100 = a fully comped, free purchase. Used when type is 'percent'. */
  percentOff: number;
  /** Fixed discount in cents. Used when type is 'amount'. */
  amountOffCents?: number;
  /** Corporate subscriptions only: 'once' (first month) or 'forever' (every month). */
  recurringDuration?: 'once' | 'forever';
  /**
   * The paid items the code applies to, e.g. ['event:premium', 'guest_download'].
   * Stored verbatim — a code covers exactly what was chosen.
   */
  scopes: string[];
  expiresAt: string;
  maxUses: number;
  /** When true the code never runs out; redemptions are still counted. */
  unlimitedUses?: boolean;
  createdBy?: string;
}): Promise<void> {
  const isAmount = input.discountType === 'amount';
  const percentOff = Math.round(input.percentOff);
  const amountOffCents = Math.round(input.amountOffCents ?? 0);
  if (isAmount) {
    if (!(amountOffCents >= 1)) throw new Error('Enter a discount amount above $0.');
  } else if (!(percentOff >= 1 && percentOff <= 100)) {
    throw new Error('Choose a discount between 1% and 100%.');
  }
  const cleaned = [
    ...new Set(input.scopes.map((scope) => scope.trim().toLowerCase()).filter(Boolean)),
  ];
  if (cleaned.length === 0) {
    throw new Error('Choose at least one item the code applies to.');
  }
  const appliesToScopes = cleaned.join(',');
  const { errors } = await client.models.DiscountCode.create(
    {
      code: input.code.trim().toUpperCase(),
      assignedTo: input.assignedTo?.trim() || null,
      active: true,
      // appliesToTier stays 'all' so the create-event flow never treats a new
      // code as tier-locked; appliesToScopes carries the real per-flow scope.
      appliesToTier: 'all',
      appliesToScopes,
      discountType: isAmount ? 'amount' : 'percent',
      percentOff,
      amountOffCents: isAmount ? amountOffCents : null,
      recurringDuration: input.recurringDuration === 'forever' ? 'forever' : 'once',
      expiresAt: input.expiresAt,
      maxUses: input.maxUses,
      unlimitedUses: input.unlimitedUses === true,
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
export async function startCheckout(
  tier: string,
  eventId?: string,
  discountCode?: string,
): Promise<string> {
  const { data, errors } = await client.mutations.createCheckoutSession(
    {
      tier: tier.trim().toLowerCase(),
      eventId: eventId || undefined,
      discountCode: discountCode?.trim().toUpperCase() || undefined,
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) {
    throw new Error(errors.map((error) => error.message).join(' · '));
  }
  if (!data?.url) {
    throw new Error('Checkout did not return a URL. Check the Stripe secret key.');
  }
  return data.url;
}

/**
 * Global-admin: total number of recorded payments. Confirms the Stripe webhook
 * is landing checkout.session.completed events into the Payment table.
 */
export async function listPaymentsCount(): Promise<number> {
  let count = 0;
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: next } = await client.models.Payment.list({
      authMode: 'userPool',
      nextToken,
      limit: 1000,
    });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
    count += data?.length ?? 0;
    nextToken = next;
  } while (nextToken);
  return count;
}

/**
 * Starts the Corporate ($149/month) subscription checkout and returns the
 * hosted Stripe URL. The webhook attaches the subscription to this account.
 */
export async function startCorporateSubscription(discountCode?: string): Promise<string> {
  const { data, errors } = await client.mutations.createCheckoutSession(
    {
      tier: 'corporate',
      kind: 'corporate',
      discountCode: discountCode?.trim().toUpperCase() || undefined,
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  if (!data?.url) throw new Error('Checkout did not return a URL.');
  return data.url;
}

/** The current host's corporate subscription row, or null if they have none. */
export async function getMyCorporateSubscription(): Promise<CorporateSubscription | null> {
  const { data, errors } = await client.models.CorporateSubscription.list({
    authMode: 'userPool',
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return (data?.[0] as CorporateSubscription) ?? null;
}

/** Whether a corporate subscription counts as active right now. */
export function isCorporateActive(sub: CorporateSubscription | null): boolean {
  if (!sub) return false;
  return sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due';
}

/** The per-event add-ons a host can buy together in one checkout. */
export type EventAddOnKey = 'extend' | 'guest_download' | 'live_slideshow';

/**
 * Buy one or more per-event add-ons in a single checkout. The function re-derives
 * and re-prices every selection from the event's own record, so the client only
 * says which keys it wants — never what they cost.
 *
 * A discount code must cover every selected item: one Stripe session takes one
 * coupon, so a partially-scoped code would discount things it wasn't meant to.
 */
export async function startAddOnCheckout(
  eventId: string,
  addons: EventAddOnKey[],
  discountCode?: string,
): Promise<string> {
  if (addons.length === 0) throw new Error('Choose at least one add-on.');
  const { data, errors } = await client.mutations.createCheckoutSession(
    {
      tier: 'addon',
      kind: 'addons',
      eventId,
      addons: addons.join(','),
      discountCode: discountCode?.trim().toUpperCase() || undefined,
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  if (!data?.url) throw new Error('Checkout did not return a URL.');
  return data.url;
}

/** One line of a print order: which photo, which product, how many copies. */
export interface PrintOrderItemInput {
  sku: string;
  copies: number;
  s3Key: string;
  photoId: string;
}

/**
 * Starts a guest print-order checkout for one or more of an event's photos and
 * returns the hosted Stripe URL. Works for guests (identityPool) and signed-in
 * hosts (userPool); the function enforces the guest-download gate. The webhook
 * submits the order to Prodigi once payment completes.
 */
export async function startPrintCheckout(
  eventId: string,
  items: PrintOrderItemInput[],
): Promise<string> {
  const { data, errors } = await client.mutations.createPrintCheckout(
    { eventId, itemsJson: JSON.stringify(items) },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  if (!data?.url) throw new Error('Checkout did not return a URL.');
  return data.url;
}

/** Opens the Stripe billing portal so a corporate host can manage/cancel. */
export async function openBillingPortal(): Promise<string> {
  const { data, errors } = await client.mutations.openBillingPortal(
    {},
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  if (!data?.url) throw new Error('The billing portal could not be opened.');
  return data.url;
}

/** Global-admin action on a user account: reset password, or enable/disable. */
export async function manageUser(
  email: string,
  action: 'resetPassword' | 'enable' | 'disable',
): Promise<string> {
  const { data, errors } = await client.mutations.manageUser(
    { email: email.trim().toLowerCase(), action },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  if (!data?.success) throw new Error(data?.message ?? 'The action could not be completed.');
  return data.message ?? 'Done.';
}

/**
 * Global-admin health check of the print provider. Unlike the other admin
 * actions this does NOT throw when it fails — a failing check's message is the
 * whole point of running it, so both outcomes come back to the caller.
 */
export async function checkPrintProvider(): Promise<{ ok: boolean; message: string }> {
  const { data, errors } = await client.mutations.checkPrintProvider({}, { authMode: 'userPool' });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return {
    ok: Boolean(data?.success),
    message: data?.message ?? 'The check returned no result.',
  };
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

/**
 * Update an event's name and/or date. Allowed only until the first photo is
 * uploaded — once guests have contributed, the event's identity is locked so
 * the name/date on their memories can't change under them. The photo-count
 * guard is re-checked here against the live record, not just the UI.
 */
export async function updateEventDetails(
  eventId: string,
  changes: { name?: string; date?: string | null },
): Promise<QREvent> {
  const { data: existing, errors: readErrors } = await client.models.Event.get(
    { id: eventId },
    { authMode: 'userPool' },
  );
  if (readErrors?.length || !existing) throw new Error('The event could not be loaded.');
  if ((existing.photoCount ?? 0) > 0) {
    throw new Error('This event already has photos, so its name and date are locked.');
  }

  const patch: { id: string; name?: string; date?: string | null } = { id: eventId };
  if (changes.name !== undefined) {
    const trimmed = changes.name.trim();
    if (!trimmed) throw new Error('Enter an event name.');
    patch.name = trimmed;
  }
  if (changes.date !== undefined) patch.date = changes.date || null;

  const { data, errors } = await client.models.Event.update(patch, { authMode: 'userPool' });
  if (errors?.length || !data) throw new Error('The event could not be updated.');
  return data as QREvent;
}

/**
 * Choose how uploads to this event are screened: 'review' holds potentially
 * explicit photos back for the host, 'allow_all' shows everything immediately.
 * Applies to photos uploaded from here on; anything already held stays held
 * until the host releases it.
 */
export async function setEventModerationMode(
  eventId: string,
  mode: 'review' | 'allow_all',
): Promise<void> {
  const { errors } = await client.models.Event.update(
    { id: eventId, moderationMode: mode },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The screening setting could not be updated.');
}

/**
 * Where to email the host when a photo is held for review. Pass an empty string
 * to turn the emails off; held photos stay reviewable in the dashboard either
 * way.
 */
export async function setEventAlertEmail(eventId: string, email: string): Promise<void> {
  const trimmed = email.trim();
  if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error('Enter a valid email address.');
  }
  const { errors } = await client.models.Event.update(
    { id: eventId, alertEmail: trimmed || null },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The alert email could not be saved.');
}

/**
 * Allow or block guest video uploads for one event. Automated screening covers
 * stills but not video, so a host who wants only screened media can turn video
 * off. Enforced server-side in createEventPhoto as well.
 */
export async function setEventVideoUploads(
  eventId: string,
  enabled: boolean,
): Promise<void> {
  const { errors } = await client.models.Event.update(
    { id: eventId, videoUploadsEnabled: enabled },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The video setting could not be updated.');
}

/** Close or reopen an event's uploads. Closed events stay viewable but reject new uploads. */
export async function setEventUploadsClosed(
  eventId: string,
  closed: boolean,
): Promise<void> {
  const { errors } = await client.models.Event.update(
    { id: eventId, uploadsClosed: closed },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The event could not be updated.');
}

/**
 * Fully remove an event: delete each photo's S3 objects + record (through the
 * ownership-checked function), then the event itself. Works for the event's
 * host (owner) and for global admins.
 */
export async function deleteEventWithPhotos(eventId: string): Promise<void> {
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

/** Backwards-compatible alias used by the global-admin dashboard. */
export async function deleteEventAsGlobalAdmin(eventId: string): Promise<void> {
  return deleteEventWithPhotos(eventId);
}

/**
 * Global-admin recovery: restore host access to an archived/expired event by
 * resetting its upload window to now. The host regains their full retention
 * period, and guests re-enter the low-res phase.
 */
export async function restoreEventAccess(eventId: string): Promise<void> {
  return setEventUploadWindowEnd(eventId, new Date().toISOString());
}

/** Global-admin: set an event's upload-window end date directly (also used to
 * simulate lifecycle phases for testing). */
export async function setEventUploadWindowEnd(eventId: string, iso: string): Promise<void> {
  const { errors } = await client.models.Event.update(
    { id: eventId, uploadWindowEndsAt: iso },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The event window could not be updated.');
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

/** A stored photo, plus whether the event already had these exact bytes. */
export interface UploadedPhoto extends QRPhoto {
  duplicate: boolean;
}

/**
 * Above this size a file is uploaded without a content hash.
 *
 * Hashing reads the whole file into memory at once, which a phone browser will
 * not survive for a half-gigabyte video — and an out-of-memory kill takes the
 * tab down rather than throwing something we could catch. Dedup is a
 * convenience, not a gate: skipping it costs a guest nothing but the chance to
 * upload the same large clip twice, which is rare and cheap next to losing
 * the upload entirely.
 */
export const MAX_HASHABLE_BYTES = 100 * 1024 * 1024;

/**
 * SHA-256 of a file's bytes as a lowercase hex string, for duplicate detection.
 * Returns null for a file too large to hash safely — see MAX_HASHABLE_BYTES.
 */
export async function computeContentHash(file: File): Promise<string | null> {
  if (file.size > MAX_HASHABLE_BYTES) return null;
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Content hashes of the photos already in an event, so the uploader can skip
 * re-uploading identical files. Best-effort: if the read fails, we return an
 * empty set and simply upload everything (dedup is a convenience, not a gate).
 */
export async function fetchEventPhotoHashes(eventId: string): Promise<Set<string>> {
  try {
    const { data, errors } = await client.queries.listEventPhotos(
      { eventId },
      { authMode: await authModeFor() },
    );
    if (errors?.length) return new Set();
    const hashes = new Set<string>();
    for (const photo of data ?? []) {
      if (photo?.contentHash) hashes.add(photo.contentHash);
    }
    return hashes;
  } catch {
    return new Set();
  }
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
): Promise<UploadedPhoto> {
  const context = await prepareEventUpload(eventId, uploaderName);
  return uploadEventPhotoWithContext(context, file, onProgress);
}

export async function uploadEventPhotoWithContext(
  context: EventUploadContext,
  file: File,
  onProgress?: (p: { loaded: number; total: number }) => void,
  contentHash?: string,
): Promise<UploadedPhoto> {
  const { eventId } = context;
  // Content-address the key so a re-upload overwrites its own object rather than
  // orphaning a second copy; falls back to a timestamp when there's no hash.
  const key = buildPhotoKey(eventId, file.name, new Date(), contentHash);
  const preview = await createPhotoPreview(file);
  const previewKey = preview ? buildPreviewKey(key) : null;
  const thumb = await createPhotoThumb(file);
  const thumbKey = thumb ? buildThumbKey(key) : null;

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

  // Confirm the original actually landed in storage before we create any record.
  // This prevents "orphan" photo records that point at a missing original (which
  // then can't be downloaded). If the object isn't there, fail the upload — no
  // record is created, and the guest can retry.
  await retryTransient(() => getProperties({ path: key }));

  if (preview && previewKey) {
    await retryTransient(() =>
      uploadData({
        path: previewKey,
        data: preview,
        options: { contentType: 'image/jpeg' },
      }).result,
    );
  }

  if (thumb && thumbKey) {
    await retryTransient(() =>
      uploadData({
        path: thumbKey,
        data: thumb,
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
        thumbS3Key: thumbKey ?? undefined,
        uploadedBy: context.uploadedBy,
        uploadedByUserId: context.uploadedByUserId,
        contentHash: contentHash ?? undefined,
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
  return { ...(photo as QRPhoto), duplicate: photo.duplicate ?? false };
}

/**
 * Load one event's photos the old (model) way. Used for moderation (needs
 * unapproved photos) and as a safety fallback for the public gallery.
 */
async function listEventPhotosViaModel(eventId: string): Promise<QRPhoto[]> {
  const { data } = await client.models.Photo.listPhotoByEventId(
    { eventId },
    { limit: 500, authMode: await authModeFor() },
  );
  return (data ?? []) as QRPhoto[];
}

/** Fetch photos for an event and resolve signed URLs for display. */
export async function fetchEventPhotos(
  eventId: string,
  opts: { includeUnapproved?: boolean; useOriginals?: boolean; useThumbs?: boolean } = {}
): Promise<DisplayPhoto[]> {
  let photos: QRPhoto[];
  if (opts.includeUnapproved) {
    // Moderation view: read the model directly (host/admin) so unapproved
    // photos are visible.
    photos = await listEventPhotosViaModel(eventId);
  } else {
    // Public gallery: scoped query that only returns this event's approved
    // photos, so photos can't be enumerated across events.
    const { data, errors } = await client.queries.listEventPhotos(
      { eventId },
      { authMode: await authModeFor() },
    );
    if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
    photos = (data ?? []).filter((p): p is NonNullable<typeof p> => p !== null) as QRPhoto[];
  }

  if (!opts.includeUnapproved) {
    photos = photos.filter((p) => p.approved !== false);
  }

  const withUrls = await Promise.all(
    photos.map(async (p) => {
      const displayPath = opts.useOriginals
        ? p.s3Key
        : opts.useThumbs
          ? p.thumbS3Key || p.previewS3Key || p.s3Key
          : p.previewS3Key || p.s3Key;
      const { url } = await getUrl({ path: displayPath });
      return { ...p, url: url.toString() };
    })
  );

  return withUrls.sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  );
}

/** A flagged photo awaiting a decision, resolved from a review link's token. */
export interface ModerationReviewView {
  token: string;
  status: string;
  eventId: string;
  eventName?: string | null;
  reasons?: string | null;
  expiresAt: string;
  /** Signed URL for the held photo, so the reviewer can see what they're deciding. */
  url: string;
}

/**
 * Load a review by its token. Works signed out — the token is the credential —
 * and returns null for an unknown token so the page can't be used to probe.
 */
export async function fetchModerationReview(
  token: string,
): Promise<ModerationReviewView | null> {
  const { data, errors } = await client.models.ModerationReview.get(
    { token },
    { authMode: await authModeFor() },
  );
  if (errors?.length || !data) return null;

  let url = '';
  try {
    const resolved = await getUrl({ path: data.photoS3Key });
    url = resolved.url.toString();
  } catch {
    return null; // the photo is gone; nothing meaningful to review
  }

  return {
    token: data.token,
    status: data.status,
    eventId: data.eventId,
    eventName: data.eventName,
    reasons: data.reasons,
    expiresAt: data.expiresAt,
    url,
  };
}

/**
 * Decide a flagged photo from a review link. 'release' shows it to guests;
 * 'dismiss' leaves it hidden. Neither deletes anything — permanent deletion
 * stays behind the signed-in dashboard.
 */
export async function reviewFlaggedPhoto(
  token: string,
  action: 'release' | 'dismiss',
): Promise<string> {
  const { data, errors } = await client.mutations.reviewFlaggedPhoto(
    { token, action },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  if (!data?.success) throw new Error(data?.message ?? 'That review could not be completed.');
  return data.message ?? 'Done.';
}

/**
 * Release a photo the content screener held back, making it visible to guests
 * and the live slideshow. Host/admin only (enforced by the Photo model's owner
 * auth). Denying is just deleting the photo, which already has its own flow.
 */
export async function releaseFlaggedPhoto(photoId: string): Promise<void> {
  const { errors } = await client.models.Photo.update(
    { id: photoId, moderationStatus: 'released' },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The photo could not be released.');
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
  // Gated on the guest-download add-on (what the host actually buys), not on the
  // plan tier — so it works on any event with guest downloads enabled (Premium
  // or Corporate), matching the admin UI that unlocks the builder on the add-on.
  if (event.guestDownloadEnabled !== true) {
    throw new Error(
      'Enable guest downloads for this event to create a download-sharing QR code.',
    );
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

/** Signed URL for the full-resolution original — used for the host's enlarged view. */
export async function getOriginalMediaUrl(photo: QRPhoto): Promise<string> {
  const { url } = await getUrl({ path: photo.s3Key });
  return url.toString();
}

/**
 * One event's approved photo records WITHOUT resolving signed URLs. The live
 * slideshow polls this every few seconds and signs URLs only for the frames it
 * is about to show, so a long-running screen doesn't re-sign hundreds of photos
 * on every poll.
 */
export async function fetchEventPhotoRecords(eventId: string): Promise<QRPhoto[]> {
  const { data, errors } = await client.queries.listEventPhotos(
    { eventId },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return (data ?? [])
    .filter((photo): photo is NonNullable<typeof photo> => photo !== null)
    .filter((photo) => photo.approved !== false) as QRPhoto[];
}

/**
 * Signed URL for a photo at display quality (the preview, falling back to the
 * original). Signed URLs are short-lived, so the slideshow re-resolves them
 * periodically rather than holding one for the whole reception.
 */
export async function getPhotoDisplayUrl(photo: QRPhoto): Promise<string> {
  const { url } = await getUrl({ path: photo.previewS3Key || photo.s3Key });
  return url.toString();
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

/**
 * Creates one ZIP download from selected photos and videos. Files that can't be
 * fetched (e.g. a missing S3 object) are skipped so one bad file doesn't fail
 * the whole download; the number skipped is returned.
 */
export async function downloadPhotosAsZip(
  photos: QRPhoto[],
  archiveName: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<{ skipped: number; failedIds: string[] }> {
  if (photos.length === 0) throw new Error('Select at least one photo or video.');

  const zip = new JSZip();
  let added = 0;
  const failedIds: string[] = [];
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    try {
      const { body } = await downloadData({ path: photo.s3Key }).result;
      const blob = await body.blob();
      const originalName = photo.s3Key.split('/').pop() || `media-${index + 1}`;
      const numberedName = `${String(index + 1).padStart(3, '0')}-${originalName}`;
      zip.file(numberedName, blob);
      added += 1;
    } catch {
      failedIds.push(photo.id); // missing/unavailable file — skip and keep going
    }
    onProgress?.(index + 1, photos.length);
  }

  if (added === 0) {
    throw new Error('None of the selected files could be downloaded.');
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
  return { skipped: failedIds.length, failedIds };
}

/**
 * One ZIP containing several events' photos, each in its own subfolder. Used by
 * the multi-event bulk download in the host dashboard (check several events →
 * download them together).
 */
export async function downloadEventsAsZip(
  events: { id: string; name: string }[],
  onProgress?: (completed: number, total: number) => void,
): Promise<{ skipped: number }> {
  // Gather each event's photos first so we know the grand total for progress.
  const groups: { name: string; photos: QRPhoto[] }[] = [];
  for (const ev of events) {
    const photos = await fetchEventPhotos(ev.id, { includeUnapproved: true });
    groups.push({ name: ev.name, photos });
  }
  const total = groups.reduce((sum, group) => sum + group.photos.length, 0);
  if (total === 0) throw new Error('The selected events have no photos to download.');

  const zip = new JSZip();
  const usedFolders = new Set<string>();
  let completed = 0;
  let added = 0;
  let skipped = 0;
  for (const group of groups) {
    // A safe, unique subfolder name per event.
    const base =
      group.name.replace(/[^a-z0-9-_ ]+/gi, '').trim().replace(/\s+/g, '-') || 'event';
    let folderName = base;
    let suffix = 2;
    while (usedFolders.has(folderName.toLowerCase())) folderName = `${base}-${suffix++}`;
    usedFolders.add(folderName.toLowerCase());
    const folder = zip.folder(folderName);
    if (!folder) continue;

    for (let index = 0; index < group.photos.length; index += 1) {
      const photo = group.photos[index];
      try {
        const { body } = await downloadData({ path: photo.s3Key }).result;
        const blob = await body.blob();
        const originalName = photo.s3Key.split('/').pop() || `media-${index + 1}`;
        folder.file(`${String(index + 1).padStart(3, '0')}-${originalName}`, blob);
        added += 1;
      } catch {
        skipped += 1; // missing/unavailable file — skip and keep going
      }
      completed += 1;
      onProgress?.(completed, total);
    }
  }

  if (added === 0) {
    throw new Error('None of the selected files could be downloaded.');
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = 'sharepix-events.zip';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
  return { skipped };
}
