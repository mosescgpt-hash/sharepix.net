/**
 * The Lambda's copy of the funnel vocabulary.
 *
 * Byte-identical to lib/analytics.ts below the header; the drift guard is in
 * __tests__/analytics-function-copy.test.ts. This copy is the one that decides
 * what may be stored: the browser can send any string it likes, and only names
 * in here become rows.
 */
export const ANALYTICS_EVENTS = [
  // Discover
  'homepage_view',
  'landing_page_view',
  // Believe
  'pricing_view',
  'how_it_works_view',
  // Decide
  'create_event_started',
  'account_created',
  'checkout_started',
  'purchase_completed',
  // Create
  'event_created',
  // Prepare
  'qr_viewed',
  'qr_downloaded',
  'template_downloaded',
  'event_link_copied',
  'event_link_shared',
  // Activate
  'guest_upload_started',
  'guest_upload_completed',
  'first_guest_upload',
  'third_unique_contributor',
  // Succeed
  'successful_event',
  'upload_milestone',
  'contributor_milestone',
  // Continue
  'bulk_download_started',
  'bulk_download_completed',
  'review_requested',
  'review_submitted',
  'featured_event_invited',
  'featured_event_submitted',
  'referral_shared',
  'referral_converted',
  'repeat_event_created',
  'retention_extension_purchased',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

const EVENT_SET = new Set<string>(ANALYTICS_EVENTS);

export function isAnalyticsEvent(name: string): name is AnalyticsEventName {
  return EVENT_SET.has(name);
}

export interface FunnelStage {
  index: number;
  key: string;
  title: string;
  /** The customer's question at this point, from the brief. */
  question: string;
  events: readonly AnalyticsEventName[];
}

export const FUNNEL_STAGES: readonly FunnelStage[] = [
  {
    index: 1,
    key: 'discover',
    title: 'Discover',
    question: 'What is SharePix?',
    events: ['homepage_view', 'landing_page_view'],
  },
  {
    index: 2,
    key: 'believe',
    title: 'Believe',
    question: 'Will this solve my problem?',
    events: ['pricing_view', 'how_it_works_view'],
  },
  {
    index: 3,
    key: 'decide',
    title: 'Decide',
    question: 'Is it worth paying for?',
    events: ['create_event_started', 'account_created', 'checkout_started', 'purchase_completed'],
  },
  {
    index: 4,
    key: 'create',
    title: 'Create',
    question: 'Is this going to be a hassle?',
    events: ['event_created'],
  },
  {
    index: 5,
    key: 'prepare',
    title: 'Prepare',
    question: 'How do I get my guests to use this?',
    events: [
      'qr_viewed',
      'qr_downloaded',
      'template_downloaded',
      'event_link_copied',
      'event_link_shared',
    ],
  },
  {
    index: 6,
    key: 'activate',
    title: 'Activate',
    question: 'Did anyone actually use it?',
    events: [
      'guest_upload_started',
      'guest_upload_completed',
      'first_guest_upload',
      'third_unique_contributor',
    ],
  },
  {
    index: 7,
    key: 'succeed',
    title: 'Succeed',
    question: 'Did the event work?',
    events: ['successful_event', 'upload_milestone', 'contributor_milestone'],
  },
  {
    index: 8,
    key: 'continue',
    title: 'Continue',
    question: 'Would they do it again?',
    events: [
      'bulk_download_started',
      'bulk_download_completed',
      'review_requested',
      'review_submitted',
      'featured_event_invited',
      'featured_event_submitted',
      'referral_shared',
      'referral_converted',
      'repeat_event_created',
      'retention_extension_purchased',
    ],
  },
] as const;

export function stageFor(name: AnalyticsEventName): FunnelStage | null {
  return FUNNEL_STAGES.find((stage) => stage.events.includes(name)) ?? null;
}

/**
 * Events written from a server path, where the row is the evidence.
 *
 * Everything else is reported by a browser and can be blocked, doubled by a
 * reload, or made up. The dashboard separates the two rather than adding them
 * together, because a funnel that mixes a measured count with a reported one
 * and prints a single conversion rate is stating a precision it does not have.
 */
export const SERVER_TRUTH: readonly AnalyticsEventName[] = [
  'purchase_completed',
  'event_created',
  'guest_upload_completed',
  'first_guest_upload',
  'third_unique_contributor',
  'successful_event',
  'upload_milestone',
  'contributor_milestone',
  'review_requested',
  'review_submitted',
  'retention_extension_purchased',
  'repeat_event_created',
] as const;

const SERVER_SET = new Set<string>(SERVER_TRUTH);

export function isServerTruth(name: AnalyticsEventName): boolean {
  return SERVER_SET.has(name);
}

/**
 * What the funnel still cannot answer, named rather than approximated.
 *
 * The same discipline lib/monthlyReport.ts uses: a stage rendered from nothing
 * is worse than a stage left out, because one wrong figure makes every other
 * figure on the page suspect.
 */
export const NOT_MEASURED_FUNNEL: readonly string[] = [
  'Unique visitors — these are event counts, not people; nothing here identifies a returning browser',
  'Referrals and conversions from them — referral_shared and referral_converted have no code that fires them yet',
  'Featured Event invitations and submissions — the programme those belong to is not built',
  'Experiments and visitor intent — not built, and deliberately so until there is traffic worth splitting',
];

/**
 * Events that may be recorded at most once for a given scope.
 *
 * A milestone that fires twice is worse than one that never fires: it turns a
 * count of events into a count of page loads. Enforced by the id below being a
 * conditional put rather than by any caller remembering.
 */
export const ONCE_PER_SCOPE: readonly AnalyticsEventName[] = [
  'event_created',
  'purchase_completed',
  'first_guest_upload',
  'third_unique_contributor',
  'successful_event',
  'review_requested',
  'review_submitted',
] as const;

const ONCE_SET = new Set<string>(ONCE_PER_SCOPE);

export function firesOnce(name: AnalyticsEventName): boolean {
  return ONCE_SET.has(name);
}

/**
 * The row id for an occurrence.
 *
 * A once-per-scope event is keyed by name and scope, so a second write is a
 * conditional-put failure rather than a second row. Everything else gets a
 * unique id and is counted as many times as it happens.
 *
 * `unique` is supplied by the caller rather than generated here so this module
 * stays pure — the Lambda passes randomUUID, the browser passes crypto's.
 */
export function analyticsId(
  name: AnalyticsEventName,
  scopeId: string,
  unique: string,
): string {
  return firesOnce(name) ? `${name}#${scopeId}` : `${name}#${scopeId}#${unique}`;
}

/**
 * Upload and contributor counts worth marking, from the brief.
 *
 * Analytics only. The brief is explicit that these are not host notifications
 * unless one is deliberately configured, and none is: a host being told their
 * event reached twenty-five uploads did not ask to be.
 */
export const UPLOAD_MILESTONES = [10, 25, 50, 100] as const;
export const CONTRIBUTOR_MILESTONES = [5, 10, 25] as const;

/**
 * Which milestones a counter crossed in this step.
 *
 * Takes the value before and after so a jump past several at once records all
 * of them, and so a counter that moved backwards — a deleted photo — records
 * nothing rather than firing the same milestone again on the way back up.
 */
export function milestonesCrossed(
  before: number,
  after: number,
  thresholds: readonly number[],
): number[] {
  if (!(after > before)) return [];
  return thresholds.filter((mark) => before < mark && after >= mark);
}

export interface FunnelFacts {
  name: AnalyticsEventName;
  count: number;
}

export interface StageTotal {
  stage: FunnelStage;
  /** Counts for the events in this stage that something actually records. */
  events: Array<{ name: AnalyticsEventName; count: number; serverTruth: boolean }>;
  /** Sum across the stage's events. Null when none of them are recorded. */
  total: number | null;
}

/**
 * Roll recorded events up by stage.
 *
 * An event with no rows is shown as zero only if something in the codebase
 * fires it; one that nothing fires yet is left out entirely and named in
 * NOT_MEASURED_FUNNEL instead. `recorded` is that list — the names the caller
 * knows are wired.
 */
export function stageTotals(
  facts: FunnelFacts[],
  recorded: readonly AnalyticsEventName[],
): StageTotal[] {
  const counts = new Map(facts.map((fact) => [fact.name, fact.count]));
  const wired = new Set<string>(recorded);

  return FUNNEL_STAGES.map((stage) => {
    const events = stage.events
      .filter((name) => wired.has(name))
      .map((name) => ({
        name,
        count: counts.get(name) ?? 0,
        serverTruth: isServerTruth(name),
      }));
    return {
      stage,
      events,
      total: events.length ? events.reduce((sum, entry) => sum + entry.count, 0) : null,
    };
  });
}

/**
 * Conversion between two stages, as a percentage.
 *
 * Null rather than zero when the earlier stage has nothing in it: dividing by
 * nothing is not a rate of zero, and a dashboard reading "0%" for a stage
 * nobody has reached yet says something false about the product.
 */
export function conversion(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return Math.round((to / from) * 100);
}
