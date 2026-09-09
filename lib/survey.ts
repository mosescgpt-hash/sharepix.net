/**
 * The post-event survey: its questions, its timing, and what makes a response
 * worth a person's attention.
 *
 * Pure. No network, no Amplify, no DOM — the page renders these definitions and
 * the submit function validates against them, so the two cannot drift into
 * disagreeing about what was asked.
 *
 * ## Why the questions live in one array
 *
 * The survey is versioned because the questions will change after the first
 * twenty events, and a stored response has to keep meaning what it meant when
 * it was given. Answers are stored under the stable `id` on each question, not
 * under a position, so inserting question 7a later cannot silently reinterpret
 * every answer already collected. `SURVEY_VERSION` is stamped on the response
 * and is the record of which wording somebody actually saw.
 */

/** Stamped on every response. Change it when the questions change. */
export const SURVEY_VERSION = 'v1.0';

export type QuestionKind = 'single' | 'multi' | 'scale' | 'nps' | 'text';

export interface SurveyOption {
  value: string;
  label: string;
  /** Reveals a small free-text box when chosen (the "Other" case). */
  withText?: boolean;
}

export interface SurveyQuestion {
  /** Stable storage key. Never reused for a different question. */
  id: string;
  section: number;
  prompt: string;
  kind: QuestionKind;
  options?: readonly SurveyOption[];
  scale?: { min: number; max: number; minLabel: string; maxLabel: string };
  /**
   * Show only when another answer is something other than `notEqualTo`.
   * Q7 ("what were they confused about") is pointless when Q6 said "No".
   */
  showWhen?: { questionId: string; notEqualTo: string };
  /** Long-form rather than a single line. Presentation only. */
  long?: boolean;
}

export interface SurveySection {
  index: number;
  title: string;
  /** Shown under the title on that step, or omitted. */
  blurb?: string;
}

export const SURVEY_SECTIONS: readonly SurveySection[] = [
  { index: 1, title: 'Your event' },
  { index: 2, title: 'How it went for your guests' },
  { index: 3, title: 'Your experience of SharePix' },
  { index: 4, title: 'Value' },
  {
    index: 5,
    title: 'Staying in touch',
    // Kept apart from the product questions on purpose, and said out loud, so
    // nobody reads a permission request as a condition of being heard.
    blurb:
      'These are all optional, and none of them change anything about your feedback above.',
  },
] as const;

/**
 * What a host is asked, in order.
 *
 * Feature options list only what SharePix actually ships. "Missions / photo
 * challenges" is deliberately absent: it does not exist in the product, and
 * asking whether an imaginary feature was valuable produces data about nothing
 * while telling a customer we have something we do not.
 */
export const SURVEY_QUESTIONS: readonly SurveyQuestion[] = [
  // Section 1 — the event itself
  {
    id: 'eventType',
    section: 1,
    prompt: 'What kind of event did you use SharePix for?',
    kind: 'single',
    options: [
      { value: 'wedding', label: 'Wedding' },
      { value: 'graduation', label: 'Graduation' },
      { value: 'birthday', label: 'Birthday' },
      { value: 'anniversary', label: 'Anniversary' },
      { value: 'family-reunion', label: 'Family reunion' },
      { value: 'church', label: 'Church event' },
      { value: 'school-team', label: 'School or team event' },
      { value: 'corporate', label: 'Corporate event' },
      { value: 'other', label: 'Something else', withText: true },
    ],
  },
  {
    id: 'attendance',
    section: 1,
    prompt: 'Roughly how many people came?',
    kind: 'single',
    options: [
      { value: 'under-25', label: 'Under 25' },
      { value: '25-49', label: '25 to 49' },
      { value: '50-99', label: '50 to 99' },
      { value: '100-199', label: '100 to 199' },
      { value: '200-499', label: '200 to 499' },
      { value: '500-plus', label: '500 or more' },
    ],
  },
  {
    id: 'setupEase',
    section: 1,
    prompt: 'Before the event, how easy was SharePix to set up?',
    kind: 'scale',
    scale: { min: 1, max: 5, minLabel: 'Very difficult', maxLabel: 'Very easy' },
  },
  {
    id: 'setupProblems',
    section: 1,
    prompt: 'Was anything confusing or difficult while you were setting it up?',
    kind: 'text',
    long: true,
  },

  // Section 2 — the guests
  {
    id: 'guestEase',
    section: 2,
    prompt: 'How easy did SharePix seem for your guests to use?',
    kind: 'scale',
    scale: { min: 1, max: 5, minLabel: 'Very difficult', maxLabel: 'Very easy' },
  },
  {
    id: 'guestHelpNeeded',
    section: 2,
    prompt: 'Did any guests ask you for help using it?',
    kind: 'single',
    options: [
      { value: 'no', label: 'No' },
      { value: 'one-or-two', label: 'Yes, one or two' },
      { value: 'several', label: 'Yes, several' },
      { value: 'many', label: 'Yes, many' },
    ],
  },
  {
    id: 'guestConfusion',
    section: 2,
    prompt: 'What were they stuck on?',
    kind: 'text',
    long: true,
    showWhen: { questionId: 'guestHelpNeeded', notEqualTo: 'no' },
  },
  {
    id: 'discoveryChannels',
    section: 2,
    prompt: 'How did guests usually find SharePix at your event?',
    kind: 'multi',
    options: [
      { value: 'qr-sign', label: 'QR-code sign' },
      { value: 'table-cards', label: 'Table cards' },
      { value: 'announcement', label: 'Someone announced it' },
      { value: 'link', label: 'Text, email or a link' },
      { value: 'social', label: 'Social media' },
      { value: 'other', label: 'Some other way', withText: true },
    ],
  },
  {
    id: 'reminderFrequency',
    section: 2,
    prompt: 'Did you have to remind guests to upload?',
    kind: 'single',
    options: [
      { value: 'not-at-all', label: 'Not at all' },
      { value: 'once', label: 'Once' },
      { value: 'a-few-times', label: 'A few times' },
      { value: 'frequently', label: 'Frequently' },
    ],
  },
  {
    id: 'participationIdeas',
    section: 2,
    prompt: 'What would have got more of your guests joining in?',
    kind: 'text',
    long: true,
  },

  // Section 3 — the product
  {
    id: 'bestPart',
    section: 3,
    prompt: 'What was the best part of using SharePix?',
    kind: 'text',
    long: true,
  },
  {
    id: 'worstPart',
    section: 3,
    prompt: 'What was the most frustrating, confusing or disappointing part?',
    kind: 'text',
    long: true,
  },
  {
    id: 'unmetExpectations',
    section: 3,
    prompt: 'Was there anything you expected SharePix to do that it did not?',
    kind: 'text',
    long: true,
  },
  {
    id: 'valuableFeatures',
    section: 3,
    prompt: 'Which parts were most valuable to you?',
    kind: 'multi',
    options: [
      { value: 'qr-access', label: 'Getting in by QR code' },
      { value: 'no-app', label: 'No app to install' },
      { value: 'no-accounts', label: 'Guests did not need accounts' },
      { value: 'photo-uploads', label: 'Photo uploads' },
      { value: 'video-uploads', label: 'Video uploads' },
      { value: 'private-gallery', label: 'A private gallery' },
      { value: 'full-res-downloads', label: 'Full-resolution downloads' },
      { value: 'slideshow', label: 'The live slideshow' },
      { value: 'guest-book', label: 'The guest book' },
      { value: 'moments', label: 'Moments (organised sections)' },
      { value: 'custom-design', label: 'Designing how it looked' },
      { value: 'other', label: 'Something else', withText: true },
    ],
  },
  {
    id: 'satisfaction',
    section: 3,
    prompt: 'Overall, how satisfied are you with SharePix?',
    kind: 'scale',
    scale: { min: 1, max: 5, minLabel: 'Very dissatisfied', maxLabel: 'Very satisfied' },
  },

  // Section 4 — value
  {
    id: 'valuePerception',
    section: 4,
    prompt: 'Knowing what you know now, how would $79 have felt for your event?',
    kind: 'single',
    options: [
      { value: 'excellent', label: 'Excellent value' },
      { value: 'good', label: 'Good value' },
      { value: 'fair', label: 'Fair' },
      { value: 'a-little-expensive', label: 'A little expensive' },
      { value: 'too-expensive', label: 'Too expensive' },
    ],
  },
  {
    id: 'wouldPay',
    section: 4,
    prompt: 'If you had not received SharePix free, would you have paid $79 for this event?',
    kind: 'single',
    options: [
      { value: 'definitely-yes', label: 'Definitely' },
      { value: 'probably-yes', label: 'Probably' },
      { value: 'not-sure', label: 'Not sure' },
      { value: 'probably-not', label: 'Probably not' },
      { value: 'definitely-not', label: 'Definitely not' },
    ],
  },
  {
    id: 'paymentBlockers',
    section: 4,
    prompt: 'What, if anything, would have stopped you paying $79?',
    kind: 'text',
    long: true,
  },
  {
    id: 'npsScore',
    section: 4,
    prompt: 'How likely are you to recommend SharePix to someone you know?',
    kind: 'nps',
    scale: { min: 0, max: 10, minLabel: 'Not at all likely', maxLabel: 'Extremely likely' },
  },
  {
    id: 'oneChange',
    section: 4,
    prompt: 'If you could change one thing about SharePix before your next event, what would it be?',
    kind: 'text',
    long: true,
  },

  // Section 5 — permissions, kept apart from everything above
  {
    id: 'followUpPermission',
    section: 5,
    prompt: 'May we come back to you with a couple of follow-up questions?',
    kind: 'single',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
  },
  {
    id: 'testimonialPermission',
    section: 5,
    prompt: 'May we quote what you have written here in our marketing?',
    kind: 'single',
    options: [
      { value: 'named', label: 'Yes, with my first name and event type' },
      { value: 'anonymous', label: 'Yes, anonymously' },
      { value: 'no', label: 'No' },
    ],
  },
  {
    id: 'photoMarketingInterest',
    section: 5,
    // Worded as a conversation, not a grant. Answering "yes" here permits us to
    // ask; it permits nothing about anybody's photographs. See MEDIA_RELEASE_NOTE.
    prompt:
      'Would you be open to talking with us separately about using a few photos from your event in our marketing?',
    kind: 'single',
    options: [
      { value: 'yes', label: 'Yes, get in touch' },
      { value: 'maybe', label: 'Maybe' },
      { value: 'no', label: 'No' },
    ],
  },
  {
    id: 'anythingElse',
    section: 5,
    prompt: 'Anything else you want us to know?',
    kind: 'text',
    long: true,
  },
] as const;

/**
 * The one thing about this survey that must never be misread.
 *
 * `photoMarketingInterest` is an answer about a future conversation. It is not
 * a licence, a release, or consent to publish anyone's photographs — and the
 * people in those photographs did not answer this survey at all. Any use of
 * customer media needs its own written release, obtained separately.
 */
export const MEDIA_RELEASE_NOTE =
  'Interest in a conversation only. Using any event photo needs a separate written release.';

/** The wording a testimonial permission was granted against, stored with it. */
export const SURVEY_CONSENT_VERSION = `survey-${SURVEY_VERSION}`;

export function questionById(id: string): SurveyQuestion | undefined {
  return SURVEY_QUESTIONS.find((question) => question.id === id);
}

export function questionsInSection(section: number): SurveyQuestion[] {
  return SURVEY_QUESTIONS.filter((question) => question.section === section);
}

/** Answers as stored: one entry per question id. */
export type SurveyAnswers = Record<string, string | number | string[] | null | undefined>;

/**
 * Whether a conditional question should be asked, given what has been answered
 * so far. Questions with no condition are always asked.
 */
export function isQuestionVisible(question: SurveyQuestion, answers: SurveyAnswers): boolean {
  if (!question.showWhen) return true;
  const value = answers[question.showWhen.questionId];
  // Unanswered means the branch has not been taken yet, so the dependent
  // question stays hidden rather than flashing into view on an empty form.
  if (value === undefined || value === null || value === '') return false;
  return String(value) !== question.showWhen.notEqualTo;
}

/**
 * Reject an answer that is not one of the offered choices, out of range, or
 * absurdly long.
 *
 * Everything here runs server-side as well as in the page: the page is a
 * convenience and the client is not trusted. An unknown question id is dropped
 * rather than stored, so a crafted submission cannot write arbitrary attributes
 * onto the row.
 */
export const MAX_TEXT_ANSWER_LENGTH = 4000;
/** Bounds the "Other: ___" boxes, which are labels rather than essays. */
export const MAX_OTHER_TEXT_LENGTH = 200;

export interface CleanResult {
  answers: SurveyAnswers;
  /** Question ids that were dropped, for logging. Never shown to the host. */
  rejected: string[];
}

export function cleanAnswers(raw: SurveyAnswers): CleanResult {
  const answers: SurveyAnswers = {};
  const rejected: string[] = [];

  for (const [id, value] of Object.entries(raw ?? {})) {
    // "Other" free text rides alongside its question as `<id>Other`.
    const otherFor = id.endsWith('Other') ? questionById(id.slice(0, -'Other'.length)) : undefined;
    if (otherFor) {
      const text = typeof value === 'string' ? value.trim().slice(0, MAX_OTHER_TEXT_LENGTH) : '';
      if (text) answers[id] = text;
      continue;
    }

    const question = questionById(id);
    if (!question) {
      rejected.push(id);
      continue;
    }

    const cleaned = cleanOne(question, value);
    if (cleaned === undefined) {
      rejected.push(id);
      continue;
    }
    if (cleaned !== null) answers[id] = cleaned;
  }

  return { answers, rejected };
}

/** One answer, or `undefined` when it is not a legal answer to this question. */
function cleanOne(
  question: SurveyQuestion,
  value: SurveyAnswers[string],
): string | number | string[] | null | undefined {
  if (value === null || value === undefined || value === '') return null;

  if (question.kind === 'text') {
    if (typeof value !== 'string') return undefined;
    const text = value.trim().slice(0, MAX_TEXT_ANSWER_LENGTH);
    return text || null;
  }

  if (question.kind === 'scale' || question.kind === 'nps') {
    const score = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(score)) return undefined;
    const { min, max } = question.scale ?? { min: 0, max: 0 };
    if (score < min || score > max) return undefined;
    return score;
  }

  const allowed = new Set((question.options ?? []).map((option) => option.value));

  if (question.kind === 'single') {
    if (typeof value !== 'string' || !allowed.has(value)) return undefined;
    return value;
  }

  // multi
  if (!Array.isArray(value)) return undefined;
  const chosen = [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))];
  if (chosen.some((entry) => !allowed.has(entry))) return undefined;
  return chosen.length ? chosen : null;
}

/**
 * When this event's host should be asked.
 *
 * Two rules, because SharePix does not know when an event finished:
 *
 * - A host who gave a date is asked three days after it.
 * - A host who gave none is asked two weeks after they got the event, which is
 *   the only other moment we can point at.
 *
 * On the date rule and time zones: `Event.date` is a plain calendar date with
 * no time and no zone, and SharePix stores no time zone anywhere. Rather than
 * invent one, the date is read as UTC midnight and three whole days are added.
 * That is late enough to be safe everywhere — an event on date D can run until
 * D 23:59 in UTC-12, which is D+1 11:59 UTC, so D+3 00:00 UTC is still more
 * than a day and a half after the latest possible finish. The failure direction
 * matters more than the precision: arriving a few hours late costs nothing,
 * and arriving mid-event costs the response.
 */
export const SURVEY_DAYS_AFTER_EVENT_DATE = 3;
export const SURVEY_DAYS_AFTER_ACQUISITION = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SurveyTimingFacts {
  /** `Event.date`, a plain YYYY-MM-DD, or null. */
  date?: string | null;
  /** When they paid, if they did. */
  paidAt?: string | null;
  /** When the event row was made. The fallback for a comped event. */
  createdAt?: string | null;
}

/** The instant the invitation becomes due, or null if it cannot be worked out. */
export function surveyDueAt(event: SurveyTimingFacts): Date | null {
  const date = (event.date ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const start = Date.parse(`${date}T00:00:00Z`);
    if (Number.isFinite(start)) {
      return new Date(start + SURVEY_DAYS_AFTER_EVENT_DATE * DAY_MS);
    }
  }

  // No usable date: measure from when they got the event. A comped Founding 20
  // host never paid, so `createdAt` stands in — it is the same moment for them.
  const acquired = Date.parse(event.paidAt ?? event.createdAt ?? '');
  if (!Number.isFinite(acquired)) return null;
  return new Date(acquired + SURVEY_DAYS_AFTER_ACQUISITION * DAY_MS);
}

export function surveyIsDue(event: SurveyTimingFacts, now: Date): boolean {
  const due = surveyDueAt(event);
  return due !== null && now.getTime() >= due.getTime();
}

/** One reminder, and only one. Days after the invitation, not after the event. */
export const SURVEY_REMINDER_DAYS = 5;

export function reminderIsDue(
  response: { requestedAt?: string | null; reminderSentAt?: string | null; completedAt?: string | null },
  now: Date,
): boolean {
  // Completed, or already reminded once: nothing further is ever sent. The
  // spec's "do not send repeated reminders" is enforced here rather than left
  // to the caller remembering.
  if (response.completedAt) return false;
  if (response.reminderSentAt) return false;
  const requested = Date.parse(response.requestedAt ?? '');
  if (!Number.isFinite(requested)) return false;
  return now.getTime() >= requested + SURVEY_REMINDER_DAYS * DAY_MS;
}

/**
 * Responses worth reading first.
 *
 * These are product-learning flags, not support tickets. A host who says the
 * upload flow confused their guests has done us a favour; treating that as a
 * complaint to be handled would waste it. The flag says "read this", nothing
 * more.
 */
export const FLAG_SATISFACTION_AT_OR_BELOW = 3;
export const FLAG_NPS_AT_OR_BELOW = 6;
/** Long enough that somebody stopped to explain something. */
export const SUBSTANTIAL_ANSWER_LENGTH = 80;

const SUBSTANTIAL_QUESTIONS = [
  'worstPart',
  'unmetExpectations',
  'paymentBlockers',
  'oneChange',
] as const;

export type ResearchFlag =
  | 'low-satisfaction'
  | 'low-nps'
  | 'would-not-pay'
  | 'substantial-answer';

export function researchFlags(answers: SurveyAnswers): ResearchFlag[] {
  const flags: ResearchFlag[] = [];

  const satisfaction = answers.satisfaction;
  if (typeof satisfaction === 'number' && satisfaction <= FLAG_SATISFACTION_AT_OR_BELOW) {
    flags.push('low-satisfaction');
  }

  const nps = answers.npsScore;
  if (typeof nps === 'number' && nps <= FLAG_NPS_AT_OR_BELOW) {
    flags.push('low-nps');
  }

  if (answers.wouldPay === 'probably-not' || answers.wouldPay === 'definitely-not') {
    flags.push('would-not-pay');
  }

  const wroteSomething = SUBSTANTIAL_QUESTIONS.some((id) => {
    const value = answers[id];
    return typeof value === 'string' && value.trim().length >= SUBSTANTIAL_ANSWER_LENGTH;
  });
  if (wroteSomething) flags.push('substantial-answer');

  return flags;
}

/** Standard NPS buckets. Kept here so the admin view and any report agree. */
export function npsBucket(score: number | null | undefined): 'promoter' | 'passive' | 'detractor' | null {
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10) return null;
  if (score >= 9) return 'promoter';
  if (score >= 7) return 'passive';
  return 'detractor';
}

/**
 * Net Promoter Score across responses: promoters minus detractors, as a
 * percentage. Null when nobody has answered, because 0 would read as neutral
 * rather than as absent — the same reason the monthly report distinguishes a
 * measured zero from an unmeasured one.
 */
export function netPromoterScore(scores: Array<number | null | undefined>): number | null {
  const buckets = scores.map(npsBucket).filter((bucket): bucket is NonNullable<typeof bucket> => bucket !== null);
  if (buckets.length === 0) return null;
  const promoters = buckets.filter((bucket) => bucket === 'promoter').length;
  const detractors = buckets.filter((bucket) => bucket === 'detractor').length;
  return Math.round(((promoters - detractors) / buckets.length) * 100);
}

/**
 * How far through the survey somebody is, for the progress indicator.
 * Counted in sections rather than questions so it moves in steps a person can
 * feel, and so a conditional question appearing does not make it go backwards.
 */
export function progressLabel(sectionIndex: number): string {
  return `${sectionIndex} of ${SURVEY_SECTIONS.length}`;
}
