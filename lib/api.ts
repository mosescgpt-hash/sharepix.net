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
  DisplayPhoto,
  DownloadShare,
  EventMoment,
  FreeEventClaimRow,
  RefundRow,
  ResearchIncentiveRow,
  GuestBookEntry,
  HostGuestBookEntry,
  QREvent,
  QRPhoto,
} from '@/lib/types';
import {
  buildDownloadFilename,
  buildPhotoKey,
  buildPreviewKey,
  buildThumbKey,
} from '@/lib/validation';
import { createSignedUrlCache } from '@/lib/signedUrlCache';
import { guestLabelFor } from '@/lib/guestLabel';
import { canTransition, type IncentiveStatus } from '@/lib/researchIncentive';
import { canTransition as canTransitionRefund } from '@/lib/refunds';
import type { MediaSource } from '@/lib/mediaSource';
import { formatEventLocation } from '@/lib/eventLocation';
import { sanitizeDisplayName } from '@/lib/account';
import { isEventThemeKey } from '@/lib/eventTheme';
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
    // Fast path only — no profile read here, since this gates a lot of UI.
    // "seth" from "seth@example.com". The host's chosen display name lives in
    // HostProfile and is read where it's actually shown (see createNewEvent).
    const displayName = loginId ? loginId.split('@')[0] : 'Host';
    return { userId: user.userId, displayName, loginId };
  } catch {
    return null;
  }
}

/**
 * The host's chosen display name, or '' if they haven't set one. Owner auth
 * means this only ever returns the caller's own profile.
 */
export async function getMyDisplayName(): Promise<string> {
  const user = await getCurrentUserInfo();
  if (!user) return '';
  try {
    const { data } = await client.models.HostProfile.get(
      { id: user.userId },
      { authMode: 'userPool' },
    );
    return data?.displayName ?? '';
  } catch {
    return '';
  }
}

/**
 * Save the host's display name (upsert on their own profile row, keyed by sub).
 * An empty value clears it, returning to the email-derived name everywhere.
 */
export async function setMyDisplayName(name: string): Promise<string> {
  const user = await getCurrentUserInfo();
  if (!user) throw new Error('Sign in to update your account.');
  const clean = sanitizeDisplayName(name);
  const existing = await client.models.HostProfile.get(
    { id: user.userId },
    { authMode: 'userPool' },
  );
  const input = { id: user.userId, displayName: clean };
  const { errors } = existing.data
    ? await client.models.HostProfile.update(input, { authMode: 'userPool' })
    : await client.models.HostProfile.create(input, { authMode: 'userPool' });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return clean;
}

/** Guests use the identity pool; signed-in users use the user pool. */
async function authModeFor(): Promise<DataAuthMode> {
  return (await getCurrentUserInfo()) ? 'userPool' : 'identityPool';
}

/**
 * Amplify's `getUrl` signs for 15 minutes. Reusing for 10 leaves five minutes of
 * validity on the most stale URL we ever hand out, which is ample for a page
 * that is already rendered — and it means revisiting a gallery serves images
 * and video from the browser cache instead of pulling them from S3 again.
 */
const SIGNED_URL_REUSE_MS = 10 * 60 * 1000;

const signedUrls = createSignedUrlCache(
  async (path: string) => (await getUrl({ path })).url.toString(),
  SIGNED_URL_REUSE_MS,
);

/** A signed display URL for a storage path, reused while it is still fresh. */
async function signedUrlFor(path: string): Promise<string> {
  return signedUrls.get(path);
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

/**
 * Create an event.
 *
 * This used to be a direct `Event.create` model write, where the browser chose
 * the plan's photo and video limits, both expiry dates, the event code, and
 * `paid` — which defaulted to true. All of that is decided by the create-event
 * function now; the Event model grants hosts no `create`, so there is no longer
 * a client-side path to an active event.
 *
 * The returned event carries `paid`: true means it is live right now (a
 * Corporate subscription covered it, or a code comped the whole price), false
 * means the caller should send the host to Stripe. The server decides which —
 * a discount code goes in the same request rather than being redeemed first.
 */
export async function createNewEvent(input: {
  name: string;
  date?: string;
  tier: string;
  /** Optional "City, State" for the event; stored as a single label. */
  city?: string;
  state?: string;
  /** An optional code. The server validates it and decides what it's worth. */
  discountCode?: string;
  /** Where they came from. Normalised server-side; see lib/attribution.ts. */
  source?: string;
}): Promise<QREvent> {
  const { data: event, errors } = await client.mutations.createHostedEvent(
    {
      name: input.name,
      tier: input.tier.trim().toLowerCase(),
      date: input.date || undefined,
      city: input.city || undefined,
      state: input.state || undefined,
      discountCode: input.discountCode?.trim().toUpperCase() || undefined,
      source: input.source || undefined,
    },
    { authMode: 'userPool' },
  );

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
   * The paid items the code applies to, e.g. ['event:premium', 'live_slideshow'].
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
/**
 * Every account that has taken its free event.
 *
 * Admin-only: the FreeEventClaim model grants no owner rules at all, so a host
 * cannot read their own claim, let alone delete it. That is the limit — if the
 * browser could remove this row, "one free event per account" would mean
 * nothing.
 *
 * The row id is the host's Cognito sub, which is what `clearFreeEventClaim`
 * takes and what an event's `owner` string starts with.
 */
/**
 * Honour an unsubscribe link.
 *
 * Open to signed-out callers, because an unsubscribe link that required signing
 * in is not an unsubscribe link — the person clicking it is often precisely the
 * person who does not want an account with us. The address alone is not enough:
 * the link's random token is checked against the stored one server-side.
 *
 * Never throws for a bad link. The page shows the same calm message either way,
 * because the alternative — an error that distinguishes "wrong token" from
 * "unknown address" — is an oracle for whether an email address belongs to a
 * SharePix customer.
 */
export async function unsubscribeFromEmails(
  email: string,
  token: string,
): Promise<{ unsubscribed: boolean; message: string }> {
  try {
    const { data, errors } = await client.mutations.unsubscribeEmail(
      { email, token },
      { authMode: await authModeFor() },
    );
    if (errors?.length || !data?.unsubscribed) {
      return {
        unsubscribed: false,
        message: 'That unsubscribe link is not valid. It may have expired.',
      };
    }
    return { unsubscribed: true, message: data.message ?? '' };
  } catch {
    return {
      unsubscribed: false,
      message: 'That unsubscribe link is not valid. It may have expired.',
    };
  }
}

/**
 * Record that someone finished the research survey.
 *
 * Never throws for a bad link, and shows the same message for a malformed one,
 * a wrong token and an unknown event — anything else lets a stranger discover
 * which event ids are real by feeding it guesses.
 */
export async function completeResearchSurvey(
  link: string,
): Promise<{ recorded: boolean; message: string }> {
  const refused = {
    recorded: false,
    message: 'That survey link is not valid. It may have expired.',
  };
  try {
    const { data, errors } = await client.mutations.completeResearchSurvey(
      { link },
      { authMode: await authModeFor() },
    );
    if (errors?.length || !data?.recorded) return refused;
    return { recorded: true, message: data.message ?? '' };
  } catch {
    return refused;
  }
}

export interface FeedbackSubmission {
  link: string;
  rating?: number;
  privateFeedback?: string;
  testimonialText?: string;
  marketingPermission?: boolean;
  displayMode?: string;
  displayName?: string;
}

export interface FeedbackOutcome {
  recorded: boolean;
  message: string;
  /** 'testimonial' | 'support' | 'done' — what the page asks for next. */
  branch: string;
  eventName: string;
}

/**
 * Record what a host thought of their event.
 *
 * Called twice in the normal flow: once with a score, then once more with a
 * testimonial or a note about what went wrong. Everything that decides what may
 * be written — whether the score is already set, whether permission was
 * explicitly granted — is re-derived server-side from the stored row.
 */
export async function submitEventFeedback(
  submission: FeedbackSubmission,
): Promise<FeedbackOutcome> {
  const refused: FeedbackOutcome = {
    recorded: false,
    message: 'That link is not valid. It may have expired.',
    branch: 'done',
    eventName: '',
  };
  try {
    const { data, errors } = await client.mutations.submitEventFeedback(
      {
        link: submission.link,
        rating: submission.rating,
        privateFeedback: submission.privateFeedback,
        testimonialText: submission.testimonialText,
        marketingPermission: submission.marketingPermission,
        displayMode: submission.displayMode,
        displayName: submission.displayName,
      },
      { authMode: await authModeFor() },
    );
    if (errors?.length || !data?.recorded) return refused;
    return {
      recorded: true,
      message: data.message ?? '',
      branch: data.branch ?? 'done',
      eventName: data.eventName ?? '',
    };
  } catch {
    return refused;
  }
}

/**
 * Everything owed, newest first. The manual fulfilment queue.
 *
 * Admin-only: this is a list of money we owe and the addresses to send it to.
 */
/**
 * Run a scheduled job now, from the admin dashboard.
 *
 * The same functions the schedules invoke, not a test double — a path that ran
 * different logic would prove nothing about the real one. Which means the
 * daily job WILL send real mail when sending is enabled, and the caller is
 * responsible for saying so before it does.
 */
export async function runScheduledJob(
  job: 'daily' | 'monthly' | 'reclaim',
): Promise<{ ok: boolean; dryRun: boolean; summary: string }> {
  const call =
    job === 'daily'
      ? client.mutations.runDailyTasks
      : job === 'monthly'
        ? client.mutations.runMonthlyReport
        : client.mutations.runStorageReclaim;
  // No arguments, so the options object is the only parameter.
  const { data, errors } = await call({ authMode: 'userPool' });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return {
    ok: data?.ok ?? false,
    dryRun: data?.dryRun ?? false,
    summary: data?.summary ?? 'The job ran but reported nothing.',
  };
}

/**
 * File a Guest Upload Promise claim for an event you own.
 *
 * Sends the event id, the attestation and an optional note. Everything that
 * decides whether money goes back — ownership, whether it was paid for, whether
 * any guest uploaded, whether the window is open, and how much — is re-derived
 * server-side. This call cannot name an amount.
 */
export async function claimGuestUploadPromise(
  eventId: string,
  attested: boolean,
  note?: string,
): Promise<{ filed: boolean; message: string }> {
  const { data, errors } = await client.mutations.claimGuestUploadPromise(
    { eventId, attested, note: note?.trim() || undefined },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return { filed: data?.filed ?? false, message: data?.message ?? '' };
}

function readRefund(row: Record<string, unknown>): RefundRow {
  return {
    id: String(row.id ?? ''),
    eventId: String(row.eventId ?? ''),
    reason: String(row.reason ?? ''),
    status: (row.status ?? 'REQUESTED') as RefundRow['status'],
    amountCents: Number(row.amountCents ?? 0),
    hostNote: (row.hostNote as string) ?? null,
    adminNote: (row.adminNote as string) ?? null,
    decidedBy: (row.decidedBy as string) ?? null,
    recordedAt: (row.recordedAt as string) ?? null,
    createdAt: (row.createdAt as string) ?? null,
  };
}

/** This host's own refund rows, so they can see what happened to a claim. */
export async function listMyRefunds(): Promise<RefundRow[]> {
  const { data, errors } = await client.models.Refund.list({
    limit: 200,
    authMode: 'userPool',
  });
  if (errors?.length) return [];
  return (data ?? []).map((row) => readRefund(row as Record<string, unknown>));
}

/** The whole ledger, newest first. Admin-only: it names amounts owed back. */
export async function listRefunds(): Promise<RefundRow[]> {
  const rows: RefundRow[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: next } = await client.models.Refund.list({
      authMode: 'userPool',
      nextToken,
      limit: 1000,
    });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
    for (const row of data ?? []) rows.push(readRefund(row as Record<string, unknown>));
    nextToken = next;
  } while (nextToken);
  return rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * Move a refund through the queue.
 *
 * `RECORDED` means a person issued the refund in Stripe and is saying so. This
 * function does not refund anything, and nothing in this codebase does — see
 * lib/refunds.ts.
 */
export async function decideRefund(
  row: RefundRow,
  next: RefundRow['status'],
  decidedBy: string,
  adminNote?: string,
): Promise<void> {
  if (!canTransitionRefund(row.status, next)) {
    throw new Error(`A ${row.status.toLowerCase()} refund cannot become ${next.toLowerCase()}.`);
  }
  const now = new Date().toISOString();
  const { errors } = await client.models.Refund.update(
    {
      id: row.id,
      status: next,
      decidedBy,
      decidedAt: now,
      ...(next === 'RECORDED' ? { recordedAt: now } : {}),
      ...(adminNote ? { adminNote } : {}),
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
}

/**
 * A setting a global admin can change without a deploy.
 *
 * Admin-only in both directions. A setting a browser could write is a setting
 * anyone could point at their own inbox.
 */
export const SETTING_KEYS = {
  monthlyReportRecipient: 'monthly-report-recipient',
} as const;

export async function readSetting(key: string): Promise<string> {
  const { data, errors } = await client.models.AppSetting.get(
    { id: key },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return (data?.value ?? '').trim();
}

/**
 * Store a setting, creating the row on first save.
 *
 * `update` on a row that does not exist silently succeeds against nothing in
 * some AppSync configurations, so this creates first and falls back to
 * updating — the failure to engineer against is an admin pressing Save, seeing
 * no error, and the value never landing.
 */
export async function writeSetting(
  key: string,
  value: string,
  updatedBy: string,
): Promise<void> {
  const created = await client.models.AppSetting.create(
    { id: key, value, updatedBy },
    { authMode: 'userPool' },
  );
  if (!created.errors?.length) return;
  const updated = await client.models.AppSetting.update(
    { id: key, value, updatedBy },
    { authMode: 'userPool' },
  );
  if (updated.errors?.length) {
    throw new Error(updated.errors.map((e) => e.message).join(' · '));
  }
}

/**
 * Set or clear an admin's judgement about an event's usage.
 *
 * '' clears it and lets the thresholds speak again. 'NORMAL' means a person
 * looked and it is fine; 'RESTRICTED' stops uploads. Nothing else is settable
 * by hand — HIGH_USAGE and REVIEW are what the thresholds compute, and an admin
 * writing one would be recording an opinion the system would then recompute.
 */
export async function setEventUsageStatus(
  eventId: string,
  status: '' | 'NORMAL' | 'RESTRICTED',
  note: string,
): Promise<void> {
  const { errors } = await client.models.Event.update(
    { id: eventId, usageStatus: status || null, usageNote: note || null },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
}

export interface FeedbackRow {
  id: string;
  eventId: string;
  eventName: string;
  rating: number | null;
  privateFeedback: string | null;
  testimonialText: string | null;
  displayText: string | null;
  marketingPermission: boolean;
  consentVersion: string | null;
  displayMode: string | null;
  displayName: string | null;
  status: string;
  supportFollowUpNeeded: boolean;
  adminNote: string | null;
  reviewedBy: string | null;
  ratingSubmittedAt: string | null;
  testimonialSubmittedAt: string | null;
  requestedAt: string | null;
}

function readFeedback(row: Record<string, unknown>): FeedbackRow {
  return {
    id: String(row.id ?? ''),
    eventId: String(row.eventId ?? ''),
    eventName: (row.eventName as string) ?? '',
    rating: typeof row.rating === 'number' ? row.rating : null,
    privateFeedback: (row.privateFeedback as string) ?? null,
    testimonialText: (row.testimonialText as string) ?? null,
    displayText: (row.displayText as string) ?? null,
    marketingPermission: row.marketingPermission === true,
    consentVersion: (row.consentVersion as string) ?? null,
    displayMode: (row.displayMode as string) ?? null,
    displayName: (row.displayName as string) ?? null,
    status: (row.status as string) ?? '',
    supportFollowUpNeeded: row.supportFollowUpNeeded === true,
    adminNote: (row.adminNote as string) ?? null,
    reviewedBy: (row.reviewedBy as string) ?? null,
    ratingSubmittedAt: (row.ratingSubmittedAt as string) ?? null,
    testimonialSubmittedAt: (row.testimonialSubmittedAt as string) ?? null,
    requestedAt: (row.requestedAt as string) ?? null,
  };
}

/** Every rating and testimonial, newest first. Admin-only. */
export async function listEventFeedback(): Promise<FeedbackRow[]> {
  const rows: FeedbackRow[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: next } = await client.models.EventFeedback.list({
      authMode: 'userPool',
      nextToken,
      limit: 1000,
    });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
    for (const row of data ?? []) rows.push(readFeedback(row as Record<string, unknown>));
    nextToken = next;
  } while (nextToken);
  return rows.sort((a, b) =>
    (b.ratingSubmittedAt ?? b.requestedAt ?? '').localeCompare(
      a.ratingSubmittedAt ?? a.requestedAt ?? '',
    ),
  );
}

/**
 * Decide a testimonial.
 *
 * Approving does not grant permission and cannot manufacture it: the
 * marketingPermission flag comes from the host and is only ever written by the
 * submit function. mayPublish() checks that flag at the moment of publishing,
 * so an approval on a row without permission publishes nothing — which is why
 * this refuses to record one rather than leaving a row that looks ready.
 */
export async function reviewTestimonial(
  row: FeedbackRow,
  next: string,
  reviewedBy: string,
  adminNote?: string,
): Promise<void> {
  if ((next === 'APPROVED' || next === 'PUBLISHED') && !row.marketingPermission) {
    throw new Error('That host did not give permission to publish their words.');
  }
  const { errors } = await client.models.EventFeedback.update(
    {
      id: row.id,
      status: next,
      reviewedBy,
      reviewedAt: new Date().toISOString(),
      ...(adminNote ? { adminNote } : {}),
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
}

/** Close a low-rating follow-up, once a person has actually answered it. */
export async function closeSupportFollowUp(id: string): Promise<void> {
  const { errors } = await client.models.EventFeedback.update(
    { id, supportFollowUpNeeded: false },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
}

export async function listResearchIncentives(): Promise<ResearchIncentiveRow[]> {
  const rows: ResearchIncentiveRow[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: next } = await client.models.ResearchIncentive.list({
      authMode: 'userPool',
      nextToken,
      limit: 1000,
    });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
    for (const row of data ?? []) {
      rows.push({
        id: row.id,
        eventId: row.eventId ?? '',
        participantEmail: row.participantEmail ?? '',
        amountUsd: row.amountUsd ?? 0,
        status: (row.status ?? 'PENDING') as ResearchIncentiveRow['status'],
        completedAt: row.completedAt ?? null,
        fulfilledAt: row.fulfilledAt ?? null,
        fulfilledBy: row.fulfilledBy ?? null,
      });
    }
    nextToken = next;
  } while (nextToken);
  return rows.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

/**
 * Mark a gift card as sent, by hand.
 *
 * The only route into FULFILLED, and it is an admin pressing a button after
 * they have actually bought and sent the card. Nothing scheduled and nothing
 * customer-facing can reach this state — see lib/researchIncentive.ts.
 */
export async function markIncentiveFulfilled(
  id: string,
  currentStatus: IncentiveStatus,
  fulfilledBy: string,
): Promise<void> {
  if (!canTransition(currentStatus, 'FULFILLED')) {
    throw new Error(`A ${currentStatus} reward cannot be marked fulfilled.`);
  }
  const { errors } = await client.models.ResearchIncentive.update(
    {
      id,
      status: 'FULFILLED',
      fulfilledAt: new Date().toISOString(),
      fulfilledBy,
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
}

export async function listFreeEventClaims(): Promise<FreeEventClaimRow[]> {
  const rows: FreeEventClaimRow[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, errors, nextToken: next } = await client.models.FreeEventClaim.list({
      authMode: 'userPool',
      nextToken,
      limit: 1000,
    });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
    for (const row of data ?? []) {
      rows.push({
        hostSub: row.id,
        eventId: row.eventId ?? null,
        claimedAt: row.claimedAt ?? row.createdAt ?? null,
      });
    }
    nextToken = next;
  } while (nextToken);
  return rows;
}

/**
 * Give an account its free event back.
 *
 * Deliberately a deliberate act. The claim is never released automatically —
 * not when the event is deleted, not when it expires — because releasing it on
 * deletion would turn "one free event" into "unlimited free events, one at a
 * time". This is the only way one comes back, and a person has to decide it.
 */
export async function clearFreeEventClaim(hostSub: string): Promise<void> {
  const id = hostSub.trim();
  if (!id) throw new Error('Which account? A host id is required.');
  const { errors } = await client.models.FreeEventClaim.delete(
    { id },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
}

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
export type EventAddOnKey = 'extend' | 'live_slideshow' | 'guest_book';

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
 * Global-admin delivery check for the held-photo alert email. Sends the real
 * message to the signed-in admin. Like the print check, a failure's message is
 * the point of running it, so this reports rather than throws.
 */
export async function sendTestAlertEmail(): Promise<{ ok: boolean; message: string }> {
  const { data, errors } = await client.mutations.sendTestAlertEmail({}, { authMode: 'userPool' });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return {
    ok: Boolean(data?.success),
    message: data?.message ?? 'The test returned no result.',
  };
}

/**
 * Global-admin grant of extra photo capacity to one event (the pilot version of
 * the "buy more storage" add-on). `additionalCredits` is added to whatever the
 * event already has; the effective limit becomes photoLimit + extraPhotoCredits.
 *
 * One of the two places that still writes the Event model directly, and it works
 * only for admins: the owner rule no longer grants `update`, so an ordinary host
 * calling this gets an authorization error rather than free capacity. That is
 * the point — this is giving away storage.
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
 * Change one or more of an event's host-editable settings.
 *
 * Every host-side write to an event goes through here. The Event model grants
 * owners no `update` — that mutation covered the whole row, `paid` and the plan
 * limits included — so the updateEventSettings function is the only path, and
 * its allow-list is what a host can actually change.
 *
 * Omit a field to leave it alone; pass an empty string to clear the ones that
 * can be cleared. The rules (the name/date lock once photos exist, the
 * moderation modes, the email format) are enforced there, not here.
 */
async function updateEventSettings(
  eventId: string,
  changes: {
    name?: string;
    date?: string | null;
    city?: string;
    state?: string;
    moderationMode?: 'review' | 'allow_all';
    alertEmail?: string | null;
    videoUploadsEnabled?: boolean;
    guestDownloadsBlocked?: boolean;
    uploadsClosed?: boolean;
    qrDotStyle?: string;
    qrColor?: string;
    /** '' clears the logo. Omit to leave the whole style alone. */
    qrLogo?: string;
    galleryFontSet?: string;
    galleryLayout?: string;
    /** '' clears the accent and returns to the SharePix palette. */
    galleryAccent?: string;
    reactionsEnabled?: boolean;
    commentsEnabled?: boolean;
  },
  failureMessage: string,
): Promise<void> {
  const { data, errors } = await client.mutations.updateEventSettings(
    {
      eventId,
      // `undefined` is dropped on the way out, which is what tells the function
      // to leave a field alone. `null` would mean "clear it", so a caller that
      // means "no change" must not send one.
      name: changes.name,
      date: changes.date === null ? '' : changes.date,
      city: changes.city,
      state: changes.state,
      moderationMode: changes.moderationMode,
      alertEmail: changes.alertEmail === null ? '' : changes.alertEmail,
      videoUploadsEnabled: changes.videoUploadsEnabled,
      guestDownloadsBlocked: changes.guestDownloadsBlocked,
      uploadsClosed: changes.uploadsClosed,
      qrDotStyle: changes.qrDotStyle,
      qrColor: changes.qrColor,
      qrLogo: changes.qrLogo,
      galleryFontSet: changes.galleryFontSet,
      galleryLayout: changes.galleryLayout,
      galleryAccent: changes.galleryAccent,
      reactionsEnabled: changes.reactionsEnabled,
      commentsEnabled: changes.commentsEnabled,
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  if (!data?.success) throw new Error(data?.message || failureMessage);
}

/**
 * Update an event's name, date and/or location. Name and date are allowed only
 * until the first photo is uploaded — once guests have contributed, the event's
 * identity is locked so it can't change under them. That guard lives in the
 * function, checked against the stored photo count.
 *
 * Returns the event as it now stands, re-read rather than assembled locally, so
 * the caller shows what was actually written.
 */
export async function updateEventDetails(
  eventId: string,
  changes: { name?: string; date?: string | null; city?: string; state?: string },
): Promise<QREvent> {
  await updateEventSettings(eventId, changes, 'The event could not be updated.');
  const updated = await fetchEvent(eventId);
  if (!updated) throw new Error('The event could not be loaded.');
  return updated;
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
  await updateEventSettings(
    eventId,
    { moderationMode: mode },
    'The screening setting could not be updated.',
  );
}

/**
 * Where to email the host when a photo is held for review. Pass an empty string
 * to turn the emails off; held photos stay reviewable in the dashboard either
 * way.
 */
export async function setEventAlertEmail(eventId: string, email: string): Promise<void> {
  await updateEventSettings(
    eventId,
    { alertEmail: email.trim() },
    'The alert email could not be saved.',
  );
}

/**
 * Allow or block guest video uploads for one event. Automated screening covers
 * stills but not video, so a host who wants only screened media can turn video
 * off. Enforced server-side in createEventPhoto as well.
 */
export async function setEventVideoUploads(eventId: string, enabled: boolean): Promise<void> {
  await updateEventSettings(
    eventId,
    { videoUploadsEnabled: enabled },
    'The video setting could not be updated.',
  );
}

/**
 * Withhold guest downloads for one event, or restore them.
 *
 * `true` hides the download controls from guests AND serves them the small
 * variant, so a withheld event does not quietly keep sending the large file.
 * The host is never affected — it is their event.
 */
export async function setEventGuestDownloadsBlocked(
  eventId: string,
  blocked: boolean,
): Promise<void> {
  await updateEventSettings(
    eventId,
    { guestDownloadsBlocked: blocked },
    'The download setting could not be updated.',
  );
}

export interface PhotoCommentRow {
  id: string;
  photoId: string;
  body: string;
  author: string;
  hidden: boolean;
  createdAt: string | null;
}

/**
 * Like a photo, or take the like back. Returns the new state.
 *
 * The guest key identifies a browser, not a person — see lib/photoEngagement.ts
 * for why that is the honest limit rather than a gap to close.
 */
export async function togglePhotoLike(
  photoId: string,
  guestKey: string,
): Promise<boolean> {
  const { data, errors } = await client.mutations.togglePhotoLike(
    { photoId, guestKey },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return data?.liked ?? false;
}

/** Leave a comment on a photo. Nothing screens the text; the host moderates. */
export async function addPhotoComment(input: {
  photoId: string;
  guestKey: string;
  body: string;
  author?: string;
}): Promise<void> {
  const { errors } = await client.mutations.addPhotoComment(
    {
      photoId: input.photoId,
      guestKey: input.guestKey,
      body: input.body,
      author: input.author,
    },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
}

/**
 * Which photos in this event this browser has liked.
 *
 * Read rather than remembered locally so a heart stays filled across devices
 * the browser key follows, and so a like that failed to save does not show as
 * saved.
 */
export async function listMyPhotoLikes(
  eventId: string,
  guestKey: string,
): Promise<Set<string>> {
  if (!guestKey) return new Set();
  const { data, errors } = await client.models.PhotoReaction.list({
    filter: { eventId: { eq: eventId }, guestKey: { eq: guestKey } },
    limit: 1000,
    authMode: await authModeFor(),
  });
  if (errors?.length) return new Set();
  return new Set((data ?? []).map((row) => String(row.photoId ?? '')));
}

/** Comments on one event's photos, oldest first within each photo. */
export async function listPhotoComments(eventId: string): Promise<PhotoCommentRow[]> {
  const { data, errors } = await client.models.PhotoComment.list({
    filter: { eventId: { eq: eventId } },
    limit: 1000,
    authMode: await authModeFor(),
  });
  if (errors?.length) return [];
  return (data ?? [])
    .map((row) => ({
      id: String(row.id ?? ''),
      photoId: String(row.photoId ?? ''),
      body: String(row.body ?? ''),
      author: String(row.author ?? ''),
      hidden: row.hidden === true,
      createdAt: (row.createdAt as string) ?? null,
    }))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/**
 * Hide or restore a comment. Host and admin only.
 *
 * Hidden rather than deleted, so a host who hides something can change their
 * mind and so the count stays reconcilable.
 */
export async function setPhotoCommentHidden(
  commentId: string,
  hidden: boolean,
  hiddenBy: string,
): Promise<void> {
  const { errors } = await client.models.PhotoComment.update(
    { id: commentId, hidden, hiddenBy },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
}

/** Turn guest likes and comments on or off for one event. */
export async function setEventEngagement(
  eventId: string,
  changes: { reactionsEnabled?: boolean; commentsEnabled?: boolean },
): Promise<void> {
  await updateEventSettings(eventId, changes, 'That setting could not be updated.');
}

/**
 * How the gallery looks: fonts, layout and an accent colour.
 *
 * Each field is independent — changing the layout says nothing about the fonts,
 * so an omitted field is left alone rather than reset. Pass '' as the accent to
 * clear it and go back to the SharePix palette.
 *
 * Every value is re-validated server-side against the lists in
 * lib/galleryTheme.ts. This function cannot store a font or layout that is not
 * one of the offered choices, whatever it is handed.
 */
export async function setEventGalleryTheme(
  eventId: string,
  theme: { galleryFontSet?: string; galleryLayout?: string; galleryAccent?: string },
): Promise<void> {
  await updateEventSettings(eventId, theme, 'The gallery style could not be saved.');
}

/** Close or reopen an event's uploads. Closed events stay viewable but reject new uploads. */
export async function setEventUploadsClosed(eventId: string, closed: boolean): Promise<void> {
  await updateEventSettings(eventId, { uploadsClosed: closed }, 'The event could not be updated.');
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

/**
 * Global-admin: put an event into a branded upload experience, or back to the
 * default. Pass null/'' to clear it.
 *
 * Writes the Event model directly, which is what makes this admin-only: the
 * owner rule grants hosts no `update`, and `themeKey` is not on the
 * updateEventSettings allow-list either. A host calling this gets an
 * authorization error, which is the point — otherwise anyone could dress their
 * event up as a con they have nothing to do with.
 */
export async function setEventTheme(
  eventId: string,
  themeKey: string | null,
): Promise<void> {
  const clean = (themeKey ?? '').trim();
  // Reject anything that isn't a theme we ship rather than storing a value the
  // gallery will silently ignore later.
  if (clean && !isEventThemeKey(clean)) throw new Error('That is not an available theme.');
  const { errors } = await client.models.Event.update(
    { id: eventId, themeKey: clean || null },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error('The event theme could not be updated.');
}

/**
 * Global-admin: set an event's upload-window end date directly (also used to
 * simulate lifecycle phases for testing).
 *
 * The other direct Event-model write, and admin-only for the same reason: this
 * date is what the whole retention lifecycle is measured from, so a host who
 * could set it would extend their own event indefinitely without paying for the
 * extension. `updateEventSettings` deliberately does not carry it.
 */
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
  /**
   * The moment every photo in this batch is filed under, if any. Resolved once
   * per batch rather than per file: a guest picks it (or scans a QR code that
   * picks it) before choosing photos, and it cannot change mid-upload.
   */
  momentId: string | null;
}

/** Resolve auth, guest credentials, and the event once for an entire upload batch. */
export async function prepareEventUpload(
  eventId: string,
  uploaderName?: string,
  momentId?: string | null,
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
    // A signed-in host uploads under their own name. A guest uses what they
    // typed, and failing that the label this browser already uses for this
    // event — which is what the upload form has always promised, and what
    // makes "how many people took part" answerable at all. See
    // lib/guestLabel.ts and lib/successfulEvent.ts.
    uploadedBy:
      user?.displayName ?? (uploaderName?.trim().slice(0, 60) || guestLabelFor(eventId)),
    uploadedByUserId: user?.userId ?? null,
    // Passed through as the guest's claim. createEventPhoto proves the moment
    // belongs to this event before filing anything under it.
    momentId: momentId?.trim() || null,
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
        momentId: context.momentId ?? undefined,
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
/**
 * One event's guest book, as guests see it: entries that are neither held for
 * review nor hidden by the host, oldest first.
 *
 * Reads through the scoped `eventGuestBook` query rather than the model, for
 * the same reason the gallery does — model list access would let anyone
 * enumerate every note left at every event on the platform.
 */
export async function fetchGuestBook(eventId: string): Promise<GuestBookEntry[]> {
  const { data, errors } = await client.queries.eventGuestBook(
    { eventId },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' \u00b7 '));
  return (data ?? [])
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .map((entry) => ({
      id: entry.id,
      eventId: entry.eventId,
      name: entry.name,
      message: entry.message ?? null,
      photoId: entry.photoId ?? null,
      createdAt: entry.createdAt ?? null,
    }));
}

/**
 * The host's view: every entry on their own event, including the ones held for
 * review and the ones they have hidden. Reads the model directly, which owner
 * auth scopes to events they own.
 */
export async function fetchGuestBookForHost(eventId: string): Promise<HostGuestBookEntry[]> {
  const { data, errors } = await client.models.GuestBookEntry.list({
    filter: { eventId: { eq: eventId } },
    authMode: 'userPool',
    limit: 1000,
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' \u00b7 '));
  return (data ?? [])
    .map((entry) => ({
      id: entry.id,
      eventId: entry.eventId,
      name: entry.name,
      message: entry.message ?? null,
      photoId: entry.photoId ?? null,
      moderationStatus: entry.moderationStatus ?? null,
      moderationReasons: entry.moderationReasons ?? null,
      hidden: entry.hidden ?? false,
      createdAt: entry.createdAt ?? null,
    }))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/**
 * Leave a note. Every rule the form applies is re-applied by the function —
 * this call is a convenience, not the control.
 */
export async function signGuestBook(input: {
  eventId: string;
  name: string;
  message?: string;
  photoId?: string | null;
}): Promise<{ id: string; pending: boolean }> {
  const { data, errors } = await client.mutations.signGuestBook(
    {
      eventId: input.eventId,
      name: input.name,
      message: input.message || undefined,
      photoId: input.photoId || undefined,
    },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' \u00b7 '));
  if (!data) throw new Error('We could not save that note. Try again in a moment.');
  return { id: data.id, pending: data.pending === true };
}

/** Show or hide one entry. Owner auth scopes this to the host's own events. */
export async function setGuestBookEntryHidden(
  entryId: string,
  hidden: boolean,
): Promise<void> {
  const { errors } = await client.models.GuestBookEntry.update(
    {
      id: entryId,
      hidden,
      // Showing a held entry records the host's decision, so it stops appearing
      // in the review queue rather than sitting there permanently answered.
      ...(hidden ? {} : { moderationStatus: 'released' }),
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' \u00b7 '));
}

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

  const displayPaths = photos.map((p) =>
    opts.useOriginals
      ? p.s3Key
      : opts.useThumbs
        ? p.thumbS3Key || p.previewS3Key || p.s3Key
        : p.previewS3Key || p.s3Key,
  );

  // Two signed URLs per photo, both produced locally: Amplify's getUrl signs
  // with the browser's own credentials and the R2 ones come back from a single
  // batched query. Neither costs a request per photo, which is what makes it
  // reasonable to carry both and let the browser choose.
  const [r2Urls, s3Urls] = await Promise.all([
    r2UrlsFor(eventId, displayPaths),
    Promise.all(displayPaths.map((path) => signedUrlFor(path))),
  ]);

  const withUrls: DisplayPhoto[] = photos.map((p, index) => {
    const s3 = s3Urls[index];
    const r2 = r2Urls.get(displayPaths[index]);
    return { ...p, url: r2 || s3, fallbackUrl: r2 ? s3 : undefined };
  });

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

/**
 * Where to load the full-resolution original from — the host's enlarged view.
 *
 * Returns both URLs rather than one: R2 first where it can serve the object,
 * S3 behind it. An original is the biggest thing we ever send, so this is worth
 * the same treatment as a download.
 */
export async function getOriginalMediaSource(photo: QRPhoto): Promise<MediaSource> {
  const [r2, s3] = await Promise.all([
    r2UrlsFor(photo.eventId, [photo.s3Key]),
    getUrl({ path: photo.s3Key }).then(({ url }) => url.toString()),
  ]);
  const primary = r2.get(photo.s3Key);
  return primary ? { primary, fallback: s3 } : { primary: s3 };
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
 * Where to load a photo at display quality (the preview, falling back to the
 * original file). Signed URLs are short-lived, so the slideshow re-resolves
 * them periodically rather than holding one for the whole reception.
 *
 * Returns R2 and S3 both, same as the gallery: a slideshow runs for hours on a
 * venue screen, so it is worth serving from the side with free egress.
 */
export async function getPhotoDisplaySource(photo: QRPhoto): Promise<MediaSource> {
  const path = photo.previewS3Key || photo.s3Key;
  const [r2, s3] = await Promise.all([
    r2UrlsFor(photo.eventId, [path]),
    signedUrlFor(path),
  ]);
  const primary = r2.get(path);
  return primary ? { primary, fallback: s3 } : { primary: s3 };
}

/**
 * Signed Cloudflare R2 URLs for a batch of stored objects, keyed by storage key.
 *
 * R2 costs nothing in egress, which on a busy event is most of the bill. A key
 * missing from the returned map means R2 can't serve it and the caller should
 * use S3. There are several ordinary reasons for that: nothing was backfilled,
 * so anything uploaded before the mirror went live is S3-only; the mirror is
 * best-effort and may have skipped a newer file; R2 may not be configured; and
 * the object may be one this caller isn't allowed (a guest asking for a video,
 * say). All of them land in the same place — the S3 path that served everything
 * before this existed.
 *
 * Batched deliberately. A gallery resolves every photo in one query rather than
 * one query per photo; a download asks for a single key through the same path.
 * Never throws: R2 being unreachable must not stop a gallery rendering.
 */
async function r2UrlsFor(
  eventId: string | undefined,
  keys: string[],
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (!eventId || keys.length === 0) return urls;
  try {
    const { data } = await client.queries.mediaUrls(
      { eventId, keys },
      { authMode: await authModeFor() },
    );
    for (const entry of data ?? []) {
      if (entry?.key && entry.url) urls.set(entry.key, entry.url);
    }
  } catch {
    // Fall through with an empty map: every caller treats a miss as "use S3".
  }
  return urls;
}

/**
 * Fetch one stored object, preferring Cloudflare R2.
 *
 * Downloads are where the bytes actually are — an original is megabytes where a
 * preview is kilobytes — so a download asks for the R2 URL first and only falls
 * back to S3 when there isn't one, or when the one there is doesn't resolve.
 */
async function fetchStoredBlob(eventId: string | undefined, key: string): Promise<Blob> {
  const url = (await r2UrlsFor(eventId, [key])).get(key);
  if (url) {
    try {
      const response = await fetch(url);
      // A 404 here is ordinary: the object was never mirrored. It cost one
      // request and no bytes, and S3 has it.
      if (response.ok) return await response.blob();
    } catch {
      // Any trouble reaching R2 is not the guest's problem — use S3.
    }
  }
  const { body } = await downloadData({ path: key }).result;
  return body.blob();
}

/**
 * Triggers a browser download of a photo, named for humans rather than for S3:
 * `001-Event-Name-Uploader.jpg`. Context is optional so callers that don't know
 * the event name or position still get a sensible name.
 */
export async function downloadPhoto(
  photo: QRPhoto,
  context: { eventName?: string; index?: number } = {},
): Promise<void> {
  const blob = await fetchStoredBlob(photo.eventId, photo.s3Key);

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = buildDownloadFilename({
    index: context.index,
    eventName: context.eventName,
    uploadedBy: photo.uploadedBy,
    s3Key: photo.s3Key,
  });
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
      const blob = await fetchStoredBlob(photo.eventId, photo.s3Key);
      zip.file(
        buildDownloadFilename({
          index: index + 1,
          eventName: archiveName,
          uploadedBy: photo.uploadedBy,
          s3Key: photo.s3Key,
        }),
        blob,
      );
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
        const blob = await fetchStoredBlob(photo.eventId, photo.s3Key);
        folder.file(
          buildDownloadFilename({
            index: index + 1,
            eventName: group.name,
            uploadedBy: photo.uploadedBy,
            s3Key: photo.s3Key,
          }),
          blob,
        );
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

// ---------------------------------------------------------------------------
// Moments — the named parts of an event. See lib/moments.ts.
// ---------------------------------------------------------------------------

/**
 * One event's moments, for the guest upload picker and the gallery.
 *
 * Reads the scoped `eventMoments` query rather than the model, because the
 * Moment model grants guests no list access at all — that would enumerate the
 * structure of every event on the platform.
 */
export async function fetchEventMoments(eventId: string): Promise<EventMoment[]> {
  const { data, errors } = await client.queries.eventMoments(
    { eventId },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' \u00b7 '));
  return (data ?? [])
    .filter((moment): moment is NonNullable<typeof moment> => moment !== null)
    .map((moment) => ({
      id: moment.id,
      eventId: moment.eventId,
      name: moment.name,
      description: moment.description ?? null,
      sortOrder: moment.sortOrder ?? 0,
      createdAt: moment.createdAt ?? null,
    }));
}

/**
 * Create a moment, or rename one by passing its id.
 *
 * Goes through the function rather than the model because `eventOwner` is a
 * client-written field: the generated createMoment would let a host stamp
 * their own owner id onto a row pointing at somebody else's event.
 */
export async function saveEventMoment(input: {
  eventId: string;
  momentId?: string | null;
  name: string;
  description?: string | null;
  sortOrder?: number | null;
}): Promise<EventMoment> {
  const { data, errors } = await client.mutations.saveMoment(
    {
      eventId: input.eventId,
      momentId: input.momentId || undefined,
      name: input.name,
      description: input.description || undefined,
      sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : undefined,
    },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' \u00b7 '));
  if (!data) throw new Error('That moment could not be saved.');
  return {
    id: data.id,
    eventId: data.eventId,
    name: data.name,
    description: data.description ?? null,
    sortOrder: data.sortOrder ?? 0,
    createdAt: data.createdAt ?? null,
  };
}

/**
 * Delete a moment. Unlike create and rename this goes straight at the model:
 * deleting requires the STORED row to already name the caller as its owner,
 * which is exactly the check we want, so no function is needed to add one.
 *
 * Photos filed under it are deliberately left alone. They keep a momentId
 * pointing at nothing, which the gallery folds back into "no moment" — losing
 * someone's photos because a label was renamed would be indefensible.
 */
export async function deleteEventMoment(momentId: string): Promise<void> {
  const { errors } = await client.models.Moment.delete(
    { id: momentId },
    { authMode: 'userPool' },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' \u00b7 '));
}

/**
 * Save how this event's QR code looks.
 *
 * The whole style goes together on purpose: the function clears the logo when
 * a style arrives without one, so sending only the colour would quietly drop
 * the host's logo. Callers pass everything they currently have.
 */
export async function saveEventQrBranding(
  eventId: string,
  branding: { qrDotStyle: string; qrColor: string; qrLogo: string | null },
): Promise<void> {
  await updateEventSettings(
    eventId,
    {
      qrDotStyle: branding.qrDotStyle,
      qrColor: branding.qrColor,
      qrLogo: branding.qrLogo ?? '',
    },
    'Your QR code style could not be saved.',
  );
}
