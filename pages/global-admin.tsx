import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { isGlobalAdmin } from '@/lib/admin';
import {
  addEventPhotoCredits,
  checkPrintProvider,
  createDiscountCode,
  deleteDiscountCode,
  deleteEventAsGlobalAdmin,
  getCurrentUserInfo,
  listAllEvents,
  listAllPhotos,
  listDiscountCodes,
  listPaymentsCount,
  manageUser,
  restoreEventAccess,
  sendTestAlertEmail,
  setDiscountCodeActive,
  setEventUploadWindowEnd,
  setEventTheme,
  startCheckout,
} from '@/lib/api';
import { EVENT_THEMES, themeKeyForEvent, themeLabel } from '@/lib/eventTheme';
import { CORPORATE_PLAN, PRICING_TIERS, getTier } from '@/lib/pricing';
import { archiveWindowEnd, eventLifecycle } from '@/lib/lifecycle';
import { DiscountCode, QREvent } from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upload-window end date that lands an event in a chosen lifecycle phase (testing). */
function simulateWindowEnd(event: QREvent, phase: string): string | null {
  const now = Date.now();
  const isCorp = event.tier === 'corporate';
  const tier = getTier(event.tier);
  const lowRes = isCorp ? CORPORATE_PLAN.guestLowResDays : tier?.guestLowResDays ?? 30;
  const retention = isCorp ? CORPORATE_PLAN.retentionDays : tier?.retentionDays ?? 90;
  switch (phase) {
    case 'open':
      return new Date(now + 30 * DAY_MS).toISOString();
    case 'lowres':
      return new Date(now - 2 * DAY_MS).toISOString();
    case 'gone':
      return new Date(now - (lowRes + 2) * DAY_MS).toISOString();
    case 'archived':
      return new Date(now - (retention + 2) * DAY_MS).toISOString();
    default:
      return null;
  }
}

/** Which bucket the lifecycle filter puts an event in. */
type PhaseGroup = 'live' | 'archived' | 'expired';

/**
 * Short human label for where an event sits in its lifecycle.
 *
 * `group` drives the filter; `recover` is whether Restore access applies, which
 * is true for anything the host can no longer reach — including an event past
 * its archive window, since restoring it is exactly how you undo that.
 */
function lifecyclePhase(event: QREvent): {
  label: string;
  recover: boolean;
  group: PhaseGroup;
  archivable: boolean;
} {
  const lc = eventLifecycle(event);
  if (!lc.uploadWindowEndsAt) {
    return { label: 'Active', recover: false, group: 'live', archivable: true };
  }
  if (lc.uploadOpen) {
    return { label: 'Open · uploads', recover: false, group: 'live', archivable: true };
  }
  if (lc.hostAccess) {
    return {
      label: lc.guestResolution === 'small' ? 'Post-window · guests low-res' : 'Host retention',
      recover: false,
      group: 'live',
      archivable: true,
    };
  }
  return lc.archived
    ? { label: 'Archived · recoverable', recover: true, group: 'archived', archivable: false }
    : { label: 'Past archive', recover: true, group: 'expired', archivable: false };
}

function defaultExpiryValue(): string {
  const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

// Every paid item a discount code can be scoped to. Event plans are listed
// individually so a code can target, say, Premium events only. Adding a new paid
// feature later means adding one entry here and passing its key from that
// checkout flow.
const PAID_ITEM_SCOPES = [
  { key: 'event:starter', label: 'Starter event' },
  { key: 'event:standard', label: 'Standard event' },
  { key: 'event:premium', label: 'Premium event' },
  { key: 'corporate', label: 'Corporate subscription' },
  { key: 'extend', label: 'Upload extensions' },
  { key: 'live_slideshow', label: 'Live slideshow' },
  { key: 'guest_book', label: 'Guest book' },
] as const;

const ALL_SCOPE_KEYS = PAID_ITEM_SCOPES.map((scope) => scope.key);

const SCOPE_LABELS: Record<string, string> = Object.fromEntries(
  PAID_ITEM_SCOPES.map((scope) => [scope.key, scope.label]),
);

/** Human-readable summary of what a stored code applies to, for the list. */
function scopeSummary(item: DiscountCode): string {
  const scopes = (item.appliesToScopes ?? '').trim();
  if (scopes && scopes !== 'all') {
    return scopes
      .split(',')
      .map((key) => SCOPE_LABELS[key.trim()] ?? key.trim())
      .join(', ');
  }
  // Legacy codes have no appliesToScopes: a tier means it was event-plan-only.
  if (!scopes && item.appliesToTier && item.appliesToTier !== 'all') {
    return `${getTier(item.appliesToTier)?.name ?? item.appliesToTier} plan only`;
  }
  return 'all paid items';
}

function GlobalAdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [events, setEvents] = useState<QREvent[]>([]);
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [paymentsCount, setPaymentsCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Archived events are otherwise needles in the full list — this is how an
  // admin finds the one a host has asked to have back.
  const [phaseFilter, setPhaseFilter] = useState<PhaseGroup | 'all'>('all');
  const [userEmail, setUserEmail] = useState('');
  const [userMessage, setUserMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [printCheck, setPrintCheck] = useState<{ text: string; ok: boolean } | null>(null);
  const [alertTest, setAlertTest] = useState<{ text: string; ok: boolean } | null>(null);

  const [code, setCode] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  // Discount amount: a preset (100/50/20) or a custom percentage.
  const [percentChoice, setPercentChoice] = useState<'100' | '50' | '20' | 'custom'>('100');
  const [customPercent, setCustomPercent] = useState(10);
  // A code takes off either a percentage or a fixed dollar amount.
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [amountOffDollars, setAmountOffDollars] = useState(10);
  // Corporate subscriptions only: does the discount apply to the first month or
  // every month? Defaults to one month.
  const [recurringDuration, setRecurringDuration] = useState<'once' | 'forever'>('once');
  // Which paid items the code can be redeemed against, chosen from a checklist
  // dropdown. Nothing is checked to start — the code covers exactly what's
  // ticked, and only that.
  const [scopeOpen, setScopeOpen] = useState(false);
  const [checkedScopes, setCheckedScopes] = useState<Set<string>>(() => new Set());
  const scopeMenuRef = useRef<HTMLDivElement | null>(null);
  const [expiresAt, setExpiresAt] = useState(defaultExpiryValue);
  const [maxUses, setMaxUses] = useState(1);
  const [unlimitedUses, setUnlimitedUses] = useState(false);

  const allScopesChecked = checkedScopes.size === ALL_SCOPE_KEYS.length;

  function toggleScope(key: string) {
    setCheckedScopes((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Summary shown on the closed dropdown button.
  const scopeButtonLabel =
    checkedScopes.size === 0
      ? 'Select paid items…'
      : PAID_ITEM_SCOPES.filter((scope) => checkedScopes.has(scope.key))
          .map((scope) => scope.label)
          .join(', ');

  // Close the dropdown on an outside click or Escape.
  useEffect(() => {
    if (!scopeOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!scopeMenuRef.current?.contains(event.target as Node)) setScopeOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScopeOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [scopeOpen]);

  const percentOff = percentChoice === 'custom' ? customPercent : Number(percentChoice);
  const amountOffCents = Math.round(amountOffDollars * 100);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const admin = await isGlobalAdmin();
      setAuthorized(admin);
      if (!admin) return;

      const [eventItems, codeItems, photos] = await Promise.all([
        listAllEvents(),
        listDiscountCodes(),
        listAllPhotos(),
      ]);
      const counts = photos.reduce<Record<string, number>>((result, photo) => {
        result[photo.eventId] = (result[photo.eventId] ?? 0) + 1;
        return result;
      }, {});

      setEvents(
        eventItems.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
      );
      setCodes(codeItems.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt)));
      setPhotoCounts(counts);

      // Payments count is best-effort: don't let a missing/empty Payment table
      // (e.g. before the webhook has ever fired) blank out the whole dashboard.
      try {
        setPaymentsCount(await listPaymentsCount());
      } catch {
        setPaymentsCount(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The global dashboard could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      if (phaseFilter !== 'all' && lifecyclePhase(event).group !== phaseFilter) return false;
      if (!query) return true;
      return [event.name, event.eventCode, event.createdBy, event.tier]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [events, search, phaseFilter]);

  const archivedCount = useMemo(
    () => events.filter((event) => lifecyclePhase(event).group !== 'live').length,
    [events],
  );

  const totalPhotos = Object.values(photoCounts).reduce((sum, count) => sum + count, 0);
  const activeCodes = codes.filter(
    (item) =>
      item.active &&
      new Date(item.expiresAt).getTime() > Date.now() &&
      (item.unlimitedUses === true || item.usedCount < item.maxUses),
  ).length;

  function generateCode() {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    setCode(`PILOT-${suffix}`);
  }

  async function handleCreateCode(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !expiresAt || (!unlimitedUses && maxUses < 1)) {
      setError('Enter a code, expiration date, and at least one use.');
      return;
    }
    if (discountType === 'amount') {
      if (!(amountOffCents >= 1)) {
        setError('Enter a discount amount above $0.');
        return;
      }
    } else if (!(percentOff >= 1 && percentOff <= 100)) {
      setError('Choose a discount between 1% and 100%.');
      return;
    }
    // The code covers exactly the ticked items — no implicit "everything".
    const scopes = [...checkedScopes];
    if (scopes.length === 0) {
      setError('Choose at least one paid item the code applies to.');
      return;
    }
    setWorking('create-code');
    setError(null);
    try {
      const user = await getCurrentUserInfo();
      await createDiscountCode({
        code,
        assignedTo,
        discountType,
        percentOff,
        amountOffCents,
        recurringDuration,
        scopes,
        expiresAt: new Date(expiresAt).toISOString(),
        // maxUses is ignored when unlimited, but the field is required, so keep
        // a sane value rather than writing 0.
        maxUses: unlimitedUses ? 1 : maxUses,
        unlimitedUses,
        createdBy: user?.displayName,
      });
      setCode('');
      setAssignedTo('');
      setMaxUses(1);
      setUnlimitedUses(false);
      setPercentChoice('100');
      setDiscountType('percent');
      setAmountOffDollars(10);
      setRecurringDuration('once');
      setCheckedScopes(new Set());
      setScopeOpen(false);
      setExpiresAt(defaultExpiryValue());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code could not be created.');
    } finally {
      setWorking(null);
    }
  }

  async function handleToggleCode(item: DiscountCode) {
    setWorking(`code-${item.code}`);
    setError(null);
    try {
      await setDiscountCodeActive(item.code, !item.active);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code could not be updated.');
    } finally {
      setWorking(null);
    }
  }

  async function handleDeleteCode(item: DiscountCode) {
    if (!window.confirm(`Remove discount code ${item.code}?`)) return;
    setWorking(`code-${item.code}`);
    setError(null);
    try {
      await deleteDiscountCode(item.code);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code could not be removed.');
    } finally {
      setWorking(null);
    }
  }

  async function handleUserAction(action: 'resetPassword' | 'enable' | 'disable') {
    if (!userEmail.trim()) {
      setUserMessage({ text: 'Enter the account email first.', ok: false });
      return;
    }
    setWorking(`user-${action}`);
    setUserMessage(null);
    try {
      const message = await manageUser(userEmail, action);
      setUserMessage({ text: message, ok: true });
    } catch (err) {
      setUserMessage({
        text: err instanceof Error ? err.message : 'The action could not be completed.',
        ok: false,
      });
    } finally {
      setWorking(null);
    }
  }

  async function handleCheckPrintProvider() {
    setWorking('print-check');
    setPrintCheck(null);
    try {
      const result = await checkPrintProvider();
      setPrintCheck({ text: result.message, ok: result.ok });
    } catch (err) {
      setPrintCheck({
        text: err instanceof Error ? err.message : 'The check could not be run.',
        ok: false,
      });
    } finally {
      setWorking(null);
    }
  }

  async function handleSendTestAlert() {
    setWorking('alert-test');
    setAlertTest(null);
    try {
      const result = await sendTestAlertEmail();
      setAlertTest({ text: result.message, ok: result.ok });
    } catch (err) {
      setAlertTest({
        text: err instanceof Error ? err.message : 'The test could not be sent.',
        ok: false,
      });
    } finally {
      setWorking(null);
    }
  }

  async function handleTestCheckout(tier: string) {
    setWorking(`checkout-${tier}`);
    setError(null);
    try {
      const url = await startCheckout(tier);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout could not be started.');
      setWorking(null);
    }
  }

  async function handleAddCredits(event: QREvent) {
    const input = window.prompt(
      `Add how many extra photos to “${event.name}”?\n\nPlan limit: ${event.photoLimit ?? 'unlimited'} · Current add-on: ${event.extraPhotoCredits ?? 0}\n\nUse a negative number to remove add-on capacity.`,
      '100',
    );
    if (input === null) return;
    const amount = parseInt(input, 10);
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Enter a whole number of photos to add or remove.');
      return;
    }

    setWorking(`credits-${event.id}`);
    setError(null);
    try {
      await addEventPhotoCredits(event.id, amount);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo capacity could not be updated.');
    } finally {
      setWorking(null);
    }
  }

  /**
   * Put an event into a branded upload experience, or back to the default.
   * Admin-only by construction: hosts have no update on the Event model at all,
   * so this call fails for anyone else.
   */
  async function handleSetTheme(event: QREvent, themeKey: string) {
    setWorking(`theme-${event.id}`);
    setError(null);
    try {
      await setEventTheme(event.id, themeKey || null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event theme could not be updated.');
    } finally {
      setWorking(null);
    }
  }

  async function handleDeleteEvent(event: QREvent) {
    if (
      !window.confirm(
        `Permanently remove “${event.name}” and all of its photos? This cannot be undone.`,
      )
    ) return;

    setWorking(`event-${event.id}`);
    setError(null);
    try {
      await deleteEventAsGlobalAdmin(event.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event could not be removed.');
    } finally {
      setWorking(null);
    }
  }

  async function handleSimulatePhase(event: QREvent, phase: string) {
    const iso = simulateWindowEnd(event, phase);
    if (!iso) return;
    setWorking(`sim-${event.id}`);
    setError(null);
    try {
      await setEventUploadWindowEnd(event.id, iso);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event window could not be updated.');
    } finally {
      setWorking(null);
    }
  }

  /**
   * Archive on request: guests lose the gallery, the host loses access, and the
   * event becomes admin-only but recoverable for the length of the archive
   * window. Nothing is deleted — Restore access puts it back.
   */
  async function handleArchiveEvent(event: QREvent) {
    const until = eventLifecycle(event).archiveEndsAt;
    if (
      !window.confirm(
        `Archive “${event.name}”?\n\nGuests lose the gallery and the host loses access immediately. Nothing is deleted — you can restore it from here${
          until ? ', and it stays recoverable for the full archive window' : ''
        }.`,
      )
    ) return;

    setWorking(`archive-${event.id}`);
    setError(null);
    try {
      await setEventUploadWindowEnd(event.id, archiveWindowEnd(event));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event could not be archived.');
    } finally {
      setWorking(null);
    }
  }

  async function handleRestoreEvent(event: QREvent) {
    if (
      !window.confirm(
        `Restore host access to “${event.name}”? This resets the upload window to today, giving the host their full retention period again.`,
      )
    ) return;

    setWorking(`restore-${event.id}`);
    setError(null);
    try {
      await restoreEventAccess(event.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event could not be restored.');
    } finally {
      setWorking(null);
    }
  }

  return (
    <Layout title="Global admin">
      <section className="py-8">
        {loading && authorized === null ? (
          <p className="text-center text-charcoal/60">Checking administrator access…</p>
        ) : authorized === false ? (
          <div className="mx-auto max-w-lg border border-charcoal/10 border-l-2 border-l-amber-600 bg-paper p-6 text-center">
            <h1 className="font-sans text-2xl font-bold tracking-[-0.02em]">Administrator access required</h1>
            <p className="mt-2 text-sm">This dashboard is restricted to sharepix.net global administrators.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="spx-eyebrow">Operations</p>
                <h1 className="font-sans text-3xl font-bold tracking-[-0.02em]">Global admin</h1>
                <p className="mt-1 text-charcoal/60">Monitor events and control complimentary pilot access.</p>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                className="self-start bg-ink px-5 py-3 text-sm font-medium text-canvas transition hover:bg-night"
              >
                Refresh dashboard
              </button>
            </div>

            {error ? (
              <Notice tone="error" className="mt-6">
                {error}
              </Notice>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="spx-card p-5">
                <p className="text-sm text-charcoal/60">Events</p>
                <p className="font-sans text-3xl font-bold tracking-[-0.02em]">{events.length}</p>
              </div>
              <div className="spx-card p-5">
                <p className="text-sm text-charcoal/60">Stored photos</p>
                <p className="font-sans text-3xl font-bold tracking-[-0.02em]">{totalPhotos.toLocaleString()}</p>
              </div>
              <div className="spx-card p-5">
                <p className="text-sm text-charcoal/60">Active discount codes</p>
                <p className="font-sans text-3xl font-bold tracking-[-0.02em]">{activeCodes}</p>
              </div>
            </div>

            <div className="mt-8 border border-dashed border-pine/50 bg-sage/40 p-5">
              <div className="flex flex-col gap-1">
                <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Payments — test mode</h2>
                <p className="text-sm text-charcoal/70">
                  Run a real Stripe checkout with the test card <span className="font-mono">4242 4242 4242 4242</span>{' '}
                  (any future date / any CVC). No real money moves. Events stay free during the pilot — this only
                  confirms the payment flow works.
                </p>
                <p className="text-sm text-charcoal/70">
                  Payments recorded by the webhook:{' '}
                  <span className="font-sans text-base font-semibold text-charcoal">
                    {paymentsCount === null ? '—' : paymentsCount.toLocaleString()}
                  </span>
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {PRICING_TIERS.map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    disabled={working === `checkout-${tier.id}`}
                    onClick={() => void handleTestCheckout(tier.id)}
                    className="bg-ink px-4 py-3 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
                  >
                    {working === `checkout-${tier.id}` ? 'Starting…' : `Test ${tier.name} · $${tier.price}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="spx-card mt-8 p-5">
              <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">User management</h2>
              <p className="text-sm text-charcoal/70">
                Reset a host&apos;s password (they get an email to set a new one — this also lets
                them back in if they&apos;re locked out), or enable/disable an account.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="spx-input min-w-0 flex-1"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={working === 'user-resetPassword'}
                    onClick={() => void handleUserAction('resetPassword')}
                    className="bg-ink px-4 py-3 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
                  >
                    {working === 'user-resetPassword' ? 'Working…' : 'Reset password'}
                  </button>
                  <button
                    type="button"
                    disabled={working === 'user-enable'}
                    onClick={() => void handleUserAction('enable')}
                    className="border border-charcoal/25 px-4 py-3 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                  >
                    {working === 'user-enable' ? 'Working…' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    disabled={working === 'user-disable'}
                    onClick={() => void handleUserAction('disable')}
                    className="border border-red-300 px-4 py-3 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    {working === 'user-disable' ? 'Working…' : 'Disable'}
                  </button>
                </div>
              </div>
              {userMessage ? (
                <p
                  className={`mt-3 border border-charcoal/10 px-3 py-2 text-sm ${
                    userMessage.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {userMessage.text}
                </p>
              ) : null}
            </div>

            <div className="spx-card mt-8 p-5">
              <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Print provider check</h2>
              <p className="text-sm text-charcoal/70">
                Asks Prodigi to price one of each print we sell. This only requests a{' '}
                <strong>quote</strong> — nothing is printed, nothing is ordered and nothing is
                charged — so it can be run any time. It confirms the API key works, that the
                servers can reach Prodigi, and that every size and its options are still valid.
              </p>
              <button
                type="button"
                disabled={working === 'print-check'}
                onClick={() => void handleCheckPrintProvider()}
                className="mt-4 bg-ink px-4 py-3 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
              >
                {working === 'print-check' ? 'Checking…' : 'Check print provider'}
              </button>
              {printCheck ? (
                <pre
                  className={`mt-3 overflow-x-auto whitespace-pre-wrap border border-charcoal/10 px-3 py-2 text-sm ${
                    printCheck.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {printCheck.text}
                </pre>
              ) : null}
            </div>

            <div className="spx-card mt-8 p-5">
              <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Alert email check</h2>
              <p className="text-sm text-charcoal/70">
                Sends you the real &ldquo;photo held for review&rdquo; alert — same message, same
                embedded preview, same buttons a host would see. Nothing is flagged and no
                host is emailed. It goes to the address on your own admin account, so this
                can never send mail to anyone else.
              </p>
              <button
                type="button"
                disabled={working === 'alert-test'}
                onClick={() => void handleSendTestAlert()}
                className="mt-4 bg-ink px-4 py-3 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
              >
                {working === 'alert-test' ? 'Sending…' : 'Send test alert email'}
              </button>
              {alertTest ? (
                <p
                  className={`mt-3 border border-charcoal/10 px-3 py-2 text-sm ${
                    alertTest.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {alertTest.text}
                </p>
              ) : null}
            </div>

            <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
              <section>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-sans text-2xl font-bold tracking-[-0.02em]">Events</h2>
                    <p className="text-sm text-charcoal/60">
                      Open a host dashboard, archive an event, or restore one that was
                      archived.
                    </p>
                  </div>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search events"
                    className="border border-charcoal/20 bg-paper px-4 py-2.5 text-sm text-charcoal focus:border-ink focus:outline-none"
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {(
                    [
                      ['all', `All (${events.length})`],
                      ['live', 'Active'],
                      ['archived', 'Archived · recoverable'],
                      ['expired', 'Past archive'],
                    ] as [PhaseGroup | 'all', string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPhaseFilter(value)}
                      className={`border px-3 py-1.5 font-medium transition ${
                        phaseFilter === value
                          ? 'border-ink bg-ink text-canvas'
                          : 'border-charcoal/25 bg-paper text-charcoal/70 hover:border-charcoal/60'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {archivedCount > 0 && phaseFilter === 'all' ? (
                    <span className="self-center text-charcoal/60">
                      {archivedCount} event{archivedCount === 1 ? '' : 's'} no longer reachable
                      by their host
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 space-y-3">
                  {filteredEvents.length === 0 ? (
                    <p className="border border-dashed border-charcoal/25 p-8 text-center text-charcoal/60">
                      No events match this search.
                    </p>
                  ) : filteredEvents.map((event) => (
                    <article key={event.id} className="spx-card p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="truncate font-sans text-lg font-bold tracking-[-0.02em]">
                            {event.name}
                            {/* Themed events are rare, so say so plainly rather
                                than leaving it only in the menu below — a theme
                                pointed at the wrong event should be obvious. */}
                            {themeKeyForEvent(event) ? (
                              <span className="ml-2 bg-sage px-2 py-0.5 align-middle text-xs font-medium text-pine">
                                {themeLabel(themeKeyForEvent(event))}
                              </span>
                            ) : null}
                          </h3>
                          <p className="mt-1 text-sm text-charcoal/60">
                            {event.createdBy ?? 'Unknown host'} · {event.tier} · {photoCounts[event.id] ?? 0}
                            {event.photoLimit == null
                              ? ' photos (unlimited)'
                              : ` / ${event.photoLimit + (event.extraPhotoCredits ?? 0)} photos`}
                            {event.extraPhotoCredits ? ` (+${event.extraPhotoCredits} add-on)` : ''}
                          </p>
                          <p className="mt-1 text-xs text-charcoal/60">
                            Code {event.eventCode} · Created {event.createdAt ? new Date(event.createdAt).toLocaleDateString() : 'unknown'}
                          </p>
                          {(() => {
                            const phase = lifecyclePhase(event);
                            const archiveEnd = eventLifecycle(event).archiveEndsAt;
                            return (
                              <>
                              {phase.group === 'archived' && archiveEnd ? (
                                <p className="mt-1 text-xs text-amber-700">
                                  Recoverable until {archiveEnd.toLocaleDateString()}
                                </p>
                              ) : null}
                              <span
                                className={`mt-2 inline-block px-2.5 py-1 text-[11px] font-semibold ${
                                  phase.recover
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-charcoal/[0.07] text-charcoal/60'
                                }`}
                              >
                                {phase.label}
                              </span>
                              </>
                            );
                          })()}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Link href={`/event/${event.id}`} className="border border-charcoal/25 px-3 py-1.5 text-charcoal transition hover:border-charcoal/60">
                            Gallery
                          </Link>
                          <Link href={`/event/${event.id}/admin`} className="border border-charcoal/25 px-3 py-1.5 text-charcoal transition hover:border-charcoal/60">
                            Manage
                          </Link>
                          {event.photoLimit != null ? (
                            <button
                              type="button"
                              disabled={working === `credits-${event.id}`}
                              onClick={() => void handleAddCredits(event)}
                              className="border border-charcoal/25 px-3 py-1.5 text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                            >
                              Add photos
                            </button>
                          ) : null}
                          {lifecyclePhase(event).archivable ? (
                            <button
                              type="button"
                              disabled={working === `archive-${event.id}`}
                              onClick={() => void handleArchiveEvent(event)}
                              className="border border-charcoal/25 px-3 py-1.5 text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                            >
                              {working === `archive-${event.id}` ? 'Archiving…' : 'Archive'}
                            </button>
                          ) : null}
                          {lifecyclePhase(event).recover ? (
                            <button
                              type="button"
                              disabled={working === `restore-${event.id}`}
                              onClick={() => void handleRestoreEvent(event)}
                              className="border border-pine px-3 py-1.5 text-pine transition hover:bg-pine hover:text-canvas disabled:opacity-50"
                            >
                              {working === `restore-${event.id}` ? 'Restoring…' : 'Restore access'}
                            </button>
                          ) : null}
                          <select
                            aria-label={`Upload experience for ${event.name}`}
                            title="Which upload experience guests see for this event"
                            disabled={working === `theme-${event.id}`}
                            value={themeKeyForEvent(event) ?? ''}
                            onChange={(e) => void handleSetTheme(event, e.target.value)}
                            className="border border-charcoal/30 px-2 py-1.5 text-charcoal disabled:opacity-50"
                          >
                            <option value="">Default experience</option>
                            {EVENT_THEMES.map((theme) => (
                              <option key={theme.key} value={theme.key}>
                                {theme.label}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Simulate lifecycle phase (testing)"
                            disabled={working === `sim-${event.id}`}
                            value=""
                            onChange={(e) => {
                              const phase = e.target.value;
                              e.target.value = '';
                              if (phase) void handleSimulatePhase(event, phase);
                            }}
                            className="border border-dashed border-charcoal/30 px-2 py-1.5 text-charcoal/60 disabled:opacity-50"
                          >
                            <option value="">Simulate…</option>
                            <option value="open">Open (uploads)</option>
                            <option value="lowres">Guests low-res</option>
                            <option value="gone">Guests gone</option>
                            {/* No "archived" here on purpose — Archive above is
                                the real action, and two ways to do the same
                                thing is how one of them gets missed. */}
                          </select>
                          <button
                            type="button"
                            disabled={working === `event-${event.id}`}
                            onClick={() => void handleDeleteEvent(event)}
                            className="border border-red-300 px-3 py-1.5 text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="font-sans text-2xl font-bold tracking-[-0.02em]">Discount codes</h2>
                <p className="text-sm text-charcoal/60">
                  Take a percentage off anything paid on the site. Default usage is one redemption.
                </p>

                <form onSubmit={handleCreateCode} className="spx-card mt-4 space-y-3 p-5">
                  <div>
                    <label htmlFor="new-code" className="text-sm font-medium">Code</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        id="new-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        placeholder="PILOT-ALEX"
                        className="spx-input min-w-0 flex-1 uppercase"
                      />
                      <button type="button" onClick={generateCode} className="border border-charcoal/25 px-3 text-sm text-charcoal transition hover:border-charcoal/60">
                        Generate
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="assigned-to" className="text-sm font-medium">Person or note</label>
                    <input
                      id="assigned-to"
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      placeholder="Alex's wedding test"
                      className="spx-input mt-2"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Applies to</label>
                    <p className="mt-0.5 text-xs text-charcoal/60">
                      Which paid items this code can be used on. Prints are excluded.
                    </p>
                    <div ref={scopeMenuRef} className="relative mt-1">
                      <button
                        type="button"
                        onClick={() => setScopeOpen((open) => !open)}
                        aria-haspopup="listbox"
                        aria-expanded={scopeOpen}
                        className="flex w-full items-center justify-between gap-2 border border-charcoal/20 bg-paper px-3 py-2.5 text-left text-sm text-charcoal focus:border-ink focus:outline-none"
                      >
                        <span className={checkedScopes.size === 0 ? 'text-charcoal/60' : ''}>
                          {scopeButtonLabel}
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-charcoal/60">
                          {scopeOpen ? '▲' : '▼'}
                        </span>
                      </button>

                      {scopeOpen ? (
                        <div
                          role="listbox"
                          aria-multiselectable="true"
                          className="absolute z-20 mt-1 w-full border border-charcoal/15 bg-paper p-1 shadow-lg"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setCheckedScopes(
                                allScopesChecked ? new Set() : new Set(ALL_SCOPE_KEYS),
                              )
                            }
                            className="w-full px-3 py-2 text-left text-xs font-medium text-pine hover:bg-pine/5"
                          >
                            {allScopesChecked ? 'Clear all' : 'Select all'}
                          </button>
                          <div className="my-1 border-t border-charcoal/10" />
                          {PAID_ITEM_SCOPES.map(({ key, label }) => (
                            <label
                              key={key}
                              role="option"
                              aria-selected={checkedScopes.has(key)}
                              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-charcoal/5"
                            >
                              <input
                                type="checkbox"
                                checked={checkedScopes.has(key)}
                                onChange={() => toggleScope(key)}
                                className="h-4 w-4 shrink-0 accent-pine"
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-charcoal/60">
                      Upload extensions and the live slideshow are redeemed on an event&apos;s{' '}
                      <span className="font-medium">Manage</span> page.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Discount</label>
                    <p className="mt-0.5 text-xs text-charcoal/60">How much to take off.</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {([
                        ['percent', 'Percentage off'],
                        ['amount', 'Dollar amount off'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDiscountType(value)}
                          className={`border px-3 py-1.5 text-sm ${
                            discountType === value
                              ? 'border-ink bg-ink text-canvas'
                              : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {discountType === 'amount' ? (
                      <div className="mt-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-charcoal/60">$</span>
                          <input
                            type="number"
                            min={1}
                            step="0.01"
                            value={amountOffDollars}
                            onChange={(e) => setAmountOffDollars(Number(e.target.value))}
                            className="spx-input w-28"
                          />
                          <span className="text-sm text-charcoal/60">off</span>
                        </div>
                        <p className="mt-1 text-xs text-charcoal/60">
                          Taken off each qualifying purchase. If it&apos;s more than the item
                          costs, the item is simply free — never a negative total.
                        </p>
                      </div>
                    ) : null}

                    <div
                      className={`mt-2 flex flex-wrap gap-2 ${
                        discountType === 'amount' ? 'hidden' : ''
                      }`}
                    >
                      {([
                        ['100', 'Free (100%)'],
                        ['20', '20% off'],
                        ['50', '50% off'],
                        ['custom', 'Custom'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPercentChoice(value)}
                          className={`border px-3 py-1.5 text-sm ${
                            percentChoice === value
                              ? 'border-ink bg-ink text-canvas'
                              : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {percentChoice === 'custom' ? (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={customPercent}
                          onChange={(e) => setCustomPercent(Number(e.target.value))}
                          className="spx-input w-24"
                        />
                        <span className="text-sm text-charcoal/60">% off</span>
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <label className="text-sm font-medium">Corporate subscriptions</label>
                    <p className="mt-0.5 text-xs text-charcoal/60">
                      How long the discount lasts on a recurring Corporate plan. One-time purchases
                      (events, extensions, add-on) are unaffected.
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {([
                        ['once', 'One month'],
                        ['forever', 'Ongoing'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRecurringDuration(value)}
                          className={`border px-3 py-1.5 text-sm ${
                            recurringDuration === value
                              ? 'border-ink bg-ink text-canvas'
                              : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_100px] gap-3">
                    <div>
                      <label htmlFor="expires-at" className="text-sm font-medium">Expires</label>
                      <input
                        id="expires-at"
                        type="datetime-local"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                        className="spx-input mt-2 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="max-uses" className="text-sm font-medium">Uses</label>
                      <input
                        id="max-uses"
                        type="number"
                        min={1}
                        max={100}
                        value={unlimitedUses ? '' : maxUses}
                        disabled={unlimitedUses}
                        placeholder="∞"
                        onChange={(e) => setMaxUses(Number(e.target.value))}
                        className="spx-input mt-2 disabled:bg-sand disabled:text-charcoal/50"
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={unlimitedUses}
                      onChange={(e) => setUnlimitedUses(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-pine"
                    />
                    <span>
                      <span className="font-medium">Unlimited uses</span>
                      <span className="block text-xs text-charcoal/60">
                        The code never runs out. Redemptions are still counted, so you can see
                        how many people used it.
                      </span>
                    </span>
                  </label>
                  <button
                    type="submit"
                    disabled={working === 'create-code'}
                    className="w-full bg-ink py-3 font-medium text-canvas transition hover:bg-night disabled:opacity-50"
                  >
                    {working === 'create-code'
                      ? 'Creating…'
                      : `Create ${
                          discountType === 'amount'
                            ? `$${amountOffDollars.toFixed(2)} off`
                            : percentOff >= 100
                              ? 'free'
                              : `${percentOff}% off`
                        } code`}
                  </button>
                </form>

                <div className="mt-4 space-y-3">
                  {codes.map((item) => {
                    const expired = new Date(item.expiresAt).getTime() <= Date.now();
                    const exhausted =
                      item.unlimitedUses !== true && item.usedCount >= item.maxUses;
                    const status = !item.active ? 'Inactive' : expired ? 'Expired' : exhausted ? 'Used' : 'Active';
                    return (
                      <article key={item.code} className="spx-card p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono font-bold text-charcoal">{item.code}</p>
                            <p className="mt-1 truncate text-xs text-charcoal/60">
                              {item.discountType === 'amount'
                                ? `$${((item.amountOffCents ?? 0) / 100).toFixed(2)} off`
                                : (item.percentOff == null ? 100 : item.percentOff) >= 100
                                  ? 'Free (100% off)'
                                  : `${item.percentOff}% off`}
                              {item.recurringDuration === 'forever' ? ' · ongoing (corp.)' : ''}
                              {' · '}
                              {scopeSummary(item)}
                              {' · '}
                              {item.assignedTo || 'No note'}
                            </p>
                          </div>
                          <span className={`px-2.5 py-1 text-xs font-semibold ${status === 'Active' ? 'bg-sage text-pine' : 'bg-amber-50 text-amber-800'}`}>
                            {status}
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-charcoal/60">
                          {item.unlimitedUses
                            ? `${item.usedCount} ${item.usedCount === 1 ? 'use' : 'uses'} · unlimited`
                            : `${item.usedCount}/${item.maxUses} uses`}{' '}
                          · expires {new Date(item.expiresAt).toLocaleString()}
                        </p>
                        <div className="mt-3 flex gap-2 text-xs">
                          <button
                            type="button"
                            disabled={working === `code-${item.code}` || expired || exhausted}
                            onClick={() => void handleToggleCode(item)}
                            className="border border-charcoal/25 px-3 py-1.5 text-charcoal transition hover:border-charcoal/60 disabled:opacity-40"
                          >
                            {item.active ? 'Expire now' : 'Reactivate'}
                          </button>
                          <button
                            type="button"
                            disabled={working === `code-${item.code}`}
                            onClick={() => void handleDeleteCode(item)}
                            className="border border-red-300 px-3 py-1.5 text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
          </>
        )}
      </section>
    </Layout>
  );
}

export default withAuthenticator(GlobalAdminPage);
