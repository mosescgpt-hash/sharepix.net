/**
 * Reading survey responses: what a row says, what to filter it by, and which
 * ones deserve reading first.
 *
 * Pure, so the dashboard's filters are unit tested rather than clicked. The
 * page renders what these return and decides nothing itself — a filter that
 * lived in the JSX would be a filter nobody could test, and this is the surface
 * where being wrong means quietly hiding a customer's complaint.
 */

import {
  npsBucket,
  researchFlags,
  type ResearchFlag,
  type SurveyAnswers,
} from './survey';
import { readMetricsSnapshot, type EventMetricsSnapshot } from './surveyMetrics';

/** One response as the admin dashboard reads it. */
export interface SurveyRow {
  id: string;
  eventId: string;
  eventName: string;
  customer: string;
  surveyVersion: string;
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  reminderSentAt: string | null;
  /** Every answer, under its question id. */
  answers: SurveyAnswers;
  /** The event as it stood at submission, or null for an unfinished one. */
  metrics: EventMetricsSnapshot | null;
}

/** Where a response is in its life, for the "completed / not" filter. */
export type SurveyStage = 'invited' | 'started' | 'completed';

export function stageOf(row: SurveyRow): SurveyStage {
  if (row.completedAt) return 'completed';
  if (row.startedAt) return 'started';
  return 'invited';
}

/**
 * Flags on a response, which are product-learning signals and not support
 * tickets.
 *
 * Only a finished response is flagged. A half-answered one has a low
 * satisfaction score in the same sense that an empty form does — the host has
 * not said anything yet, and treating that as a complaint would put noise at
 * the top of the list the flags exist to prioritise.
 */
export function flagsFor(row: SurveyRow): ResearchFlag[] {
  if (!row.completedAt) return [];
  return researchFlags(row.answers);
}

export interface SurveyFilters {
  /** Free text over event name, host and the long answers. */
  search?: string;
  stage?: SurveyStage | 'all';
  eventType?: string | 'all';
  /** Inclusive ISO dates bounding completedAt. */
  from?: string;
  to?: string;
  /** Keep responses at or below this satisfaction score. */
  maxSatisfaction?: number | null;
  /** Keep responses at or below this NPS score. */
  maxNps?: number | null;
  wouldPay?: string | 'all';
  testimonialPermission?: string | 'all';
  photoMarketingInterest?: string | 'all';
  /** Keep only responses carrying at least one research flag. */
  flaggedOnly?: boolean;
  /** Keep only events in a named internal cohort. */
  cohort?: string | 'all';
}

/** The long answers, searched as one blob so a phrase finds the response. */
const SEARCHABLE_ANSWERS = [
  'setupProblems',
  'guestConfusion',
  'participationIdeas',
  'bestPart',
  'worstPart',
  'unmetExpectations',
  'paymentBlockers',
  'oneChange',
  'anythingElse',
] as const;

function haystack(row: SurveyRow): string {
  const written = SEARCHABLE_ANSWERS.map((id) => {
    const value = row.answers[id];
    return typeof value === 'string' ? value : '';
  });
  return [row.eventName, row.customer, ...written].join(' ').toLowerCase();
}

/**
 * Apply the filters, in the order that discards the most first.
 *
 * A filter left unset means "do not narrow by this", never "match nothing" —
 * an empty dashboard because a control defaulted to a value nobody chose is the
 * failure worth avoiding here.
 */
export function filterSurveys(rows: SurveyRow[], filters: SurveyFilters): SurveyRow[] {
  return rows.filter((row) => {
    if (filters.stage && filters.stage !== 'all' && stageOf(row) !== filters.stage) return false;

    if (filters.flaggedOnly && flagsFor(row).length === 0) return false;

    if (filters.eventType && filters.eventType !== 'all') {
      if ((row.answers.eventType ?? row.metrics?.eventType ?? '') !== filters.eventType) {
        return false;
      }
    }

    if (filters.cohort && filters.cohort !== 'all') {
      if ((row.metrics?.internalCohort ?? '') !== filters.cohort) return false;
    }

    // Dates bound when it was finished, so an unfinished response is outside
    // any range rather than inside every one.
    if (filters.from || filters.to) {
      const done = row.completedAt ?? '';
      if (!done) return false;
      if (filters.from && done < filters.from) return false;
      // Inclusive of the end date: a bare YYYY-MM-DD would otherwise exclude
      // everything answered on it, which is not what picking that day means.
      if (filters.to && done > `${filters.to}T23:59:59.999Z`) return false;
    }

    if (typeof filters.maxSatisfaction === 'number') {
      const score = row.answers.satisfaction;
      if (typeof score !== 'number' || score > filters.maxSatisfaction) return false;
    }

    if (typeof filters.maxNps === 'number') {
      const score = row.answers.npsScore;
      if (typeof score !== 'number' || score > filters.maxNps) return false;
    }

    for (const [key, wanted] of [
      ['wouldPay', filters.wouldPay],
      ['testimonialPermission', filters.testimonialPermission],
      ['photoMarketingInterest', filters.photoMarketingInterest],
    ] as const) {
      if (wanted && wanted !== 'all' && row.answers[key] !== wanted) return false;
    }

    const search = (filters.search ?? '').trim().toLowerCase();
    if (search && !haystack(row).includes(search)) return false;

    return true;
  });
}

/** Newest finished first; unfinished ones after, by when they were invited. */
export function sortSurveys(rows: SurveyRow[]): SurveyRow[] {
  return [...rows].sort((a, b) => {
    if (Boolean(a.completedAt) !== Boolean(b.completedAt)) return a.completedAt ? -1 : 1;
    const left = a.completedAt ?? a.requestedAt ?? '';
    const right = b.completedAt ?? b.requestedAt ?? '';
    return right.localeCompare(left);
  });
}

export interface SurveySummary {
  invited: number;
  started: number;
  completed: number;
  flagged: number;
  /** Completed over invited, as a percentage, or null when nobody was invited. */
  responseRate: number | null;
  /** Mean satisfaction across finished responses, or null. */
  meanSatisfaction: number | null;
  /** NPS across finished responses, or null when nobody scored it. */
  nps: number | null;
  /** How many would pay, of those who answered that question. */
  wouldPayYes: number;
  wouldPayAnswered: number;
}

/**
 * The numbers above the table.
 *
 * Every one of these is null rather than zero when there is nothing behind it.
 * A dashboard reading "NPS 0" for an empty programme states a measured result,
 * and a reader who believes it once stops believing the rest.
 */
export function summarise(rows: SurveyRow[]): SurveySummary {
  const completed = rows.filter((row) => row.completedAt);

  const satisfactions = completed
    .map((row) => row.answers.satisfaction)
    .filter((score): score is number => typeof score === 'number');

  const npsScores = completed
    .map((row) => row.answers.npsScore)
    .filter((score): score is number => typeof score === 'number');

  const npsBuckets = npsScores
    .map(npsBucket)
    .filter((bucket): bucket is NonNullable<ReturnType<typeof npsBucket>> => bucket !== null);

  const wouldPayAnswers = completed
    .map((row) => row.answers.wouldPay)
    .filter((value): value is string => typeof value === 'string');

  return {
    invited: rows.length,
    started: rows.filter((row) => stageOf(row) === 'started').length,
    completed: completed.length,
    flagged: rows.filter((row) => flagsFor(row).length > 0).length,
    responseRate: rows.length ? Math.round((completed.length / rows.length) * 100) : null,
    meanSatisfaction: satisfactions.length
      ? Math.round((satisfactions.reduce((sum, s) => sum + s, 0) / satisfactions.length) * 10) / 10
      : null,
    nps: npsBuckets.length
      ? Math.round(
          ((npsBuckets.filter((b) => b === 'promoter').length -
            npsBuckets.filter((b) => b === 'detractor').length) /
            npsBuckets.length) *
            100,
        )
      : null,
    wouldPayYes: wouldPayAnswers.filter(
      (value) => value === 'definitely-yes' || value === 'probably-yes',
    ).length,
    wouldPayAnswered: wouldPayAnswers.length,
  };
}

/** Turn a stored row into what the dashboard reads. */
export function readSurveyRow(raw: Record<string, unknown>, answerIds: string[]): SurveyRow {
  const answers: SurveyAnswers = {};
  for (const id of answerIds) {
    const value = raw[id];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number') answers[id] = value;
    else if (Array.isArray(value)) answers[id] = value.map((entry) => String(entry));
  }

  return {
    id: String(raw.id ?? ''),
    eventId: String(raw.eventId ?? ''),
    eventName: String(raw.eventName ?? ''),
    customer: String(raw.customer ?? ''),
    surveyVersion: String(raw.surveyVersion ?? ''),
    requestedAt: (raw.requestedAt as string) ?? null,
    startedAt: (raw.startedAt as string) ?? null,
    completedAt: (raw.completedAt as string) ?? null,
    reminderSentAt: (raw.reminderSentAt as string) ?? null,
    answers,
    metrics: readMetricsSnapshot((raw.metricsJson as string) ?? null),
  };
}

/** Human wording for a stored answer value, for the table. */
export function labelForAnswer(questionId: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return String(value);
}
