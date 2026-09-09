import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { surveyAction, type SurveyState } from '@/lib/api';
import {
  MAX_OTHER_TEXT_LENGTH,
  MAX_TEXT_ANSWER_LENGTH,
  SURVEY_SECTIONS,
  type SurveyAnswers,
  type SurveyQuestion,
  isQuestionVisible,
  progressLabel,
  questionsInSection,
} from '@/lib/survey';
import { SUPPORT_EMAIL } from '@/lib/businessInfo';

/**
 * The post-event survey.
 *
 * Five short steps rather than twenty-four questions on one page, because the
 * length is the thing that stops people finishing. Nothing is required: a host
 * who wants to answer two questions and leave has still told us something, and
 * a form that refuses to move on until every box is filled turns that into
 * nothing at all.
 *
 * ## Autosave
 *
 * Answers are saved when a step is finished and again a few seconds after
 * typing stops, so closing the tab in the middle of a long answer does not cost
 * it. The row is not complete until the final button: `completedAt` is what
 * locks it, and only submitting sets that.
 *
 * ## What this page is not
 *
 * It is not the fence. Every answer is validated again server-side by the
 * survey-response function, which is what decides what may be stored. The
 * checks here are a courtesy to the host — they keep somebody from losing work
 * to a rejected submission — and nothing more.
 */

type Phase = 'loading' | 'invalid' | 'answering' | 'sending' | 'done';

/** How long after the last keystroke an autosave fires. */
const AUTOSAVE_IDLE_MS = 2500;

export default function SurveyPage() {
  const router = useRouter();
  const link = typeof router.query.link === 'string' ? router.query.link : '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [eventName, setEventName] = useState('');
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [step, setStep] = useState(0);

  // Autosave bookkeeping. `dirty` is a ref rather than state so that saving
  // does not itself trigger the effect that saves.
  const dirty = useRef(false);
  const saving = useRef(false);

  const section = SURVEY_SECTIONS[step];
  const visibleQuestions = useMemo(
    () => questionsInSection(section?.index ?? 1).filter((q) => isQuestionVisible(q, answers)),
    [section, answers],
  );

  const applyState = useCallback((state: SurveyState) => {
    setEventName(state.eventName);
    // Question one arrives already answered when SharePix knows the event
    // type — but only as a starting point, never overwriting an answer the
    // host has already given, and they can change it.
    const stored = state.answers ?? {};
    setAnswers(
      state.eventType && !stored.eventType
        ? { ...stored, eventType: state.eventType }
        : stored,
    );
    if (state.completed) {
      setMessage(state.message);
      setPhase('done');
      return;
    }
    if (!state.ok) {
      setMessage(state.message);
      setPhase('invalid');
      return;
    }
    setPhase('answering');
  }, []);

  // Open it once the route parameter has arrived. Next gives an empty query on
  // the first render of a dynamic route, so this waits rather than sending a
  // request for an empty link.
  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    void (async () => {
      const state = await surveyAction(link, 'open');
      if (!cancelled) applyState(state);
    })();
    return () => {
      cancelled = true;
    };
  }, [link, applyState]);

  const save = useCallback(async () => {
    if (!link || !dirty.current || saving.current) return;
    saving.current = true;
    dirty.current = false;
    const state = await surveyAction(link, 'save', answers);
    saving.current = false;
    // A save that comes back "already completed" means this survey was
    // submitted elsewhere — another tab, or a second click. Stop asking.
    if (state.completed) {
      setMessage(state.message);
      setPhase('done');
    }
  }, [link, answers]);

  // Autosave a few seconds after typing stops.
  useEffect(() => {
    if (phase !== 'answering' || !dirty.current) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_IDLE_MS);
    return () => clearTimeout(timer);
  }, [answers, phase, save]);

  function setAnswer(id: string, value: SurveyAnswers[string]) {
    dirty.current = true;
    setAnswers((current) => {
      const next = { ...current };
      if (value === null || value === undefined || value === '') delete next[id];
      else next[id] = value;
      return next;
    });
  }

  async function nextStep() {
    await save();
    setStep((current) => Math.min(current + 1, SURVEY_SECTIONS.length - 1));
    // A new step starts at the top; on a phone the previous step's last
    // question is otherwise still what you are looking at.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function previousStep() {
    setStep((current) => Math.max(current - 1, 0));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    setPhase('sending');
    dirty.current = false;
    const state = await surveyAction(link, 'submit', answers);
    if (state.completed || state.ok) {
      setMessage(state.message);
      setPhase('done');
      return;
    }
    setMessage(state.message);
    setPhase('invalid');
  }

  if (phase === 'loading') {
    return (
      <Layout title="Your feedback">
        <section className="spx-section-canvas">
          <div className="mx-auto w-full max-w-xl">
            <p className="spx-body" role="status">
              Opening your survey…
            </p>
          </div>
        </section>
      </Layout>
    );
  }

  if (phase === 'invalid') {
    return (
      <Layout title="Your feedback">
        <section className="spx-section-canvas">
          <div className="mx-auto w-full max-w-xl">
            <p className="spx-eyebrow">Feedback</p>
            <h1 className="mt-3">
              <span className="spx-display block">That link</span>
              <span className="spx-display-serif block">didn&rsquo;t work.</span>
            </h1>
            <Notice tone="warn" className="mt-8">
              {message}
            </Notice>
            <p className="spx-body mt-6">
              If you think it should have, write to{' '}
              <a className="font-medium text-pine underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{' '}
              and we will sort it out.
            </p>
          </div>
        </section>
      </Layout>
    );
  }

  if (phase === 'done') {
    return (
      <Layout title="Thank you">
        <section className="spx-section-canvas">
          <div className="mx-auto w-full max-w-xl">
            <p className="spx-eyebrow">Feedback</p>
            <h1 className="mt-3">
              <span className="spx-display block">Thank you.</span>
              <span className="spx-display-serif block">That is exactly what we needed.</span>
            </h1>
            <p className="spx-body mt-6">
              This is the kind of feedback that makes SharePix better. We appreciate you
              trusting us with {eventName || 'your event'}, and helping shape what comes
              next.
            </p>
            {message ? (
              <Notice tone="success" className="mt-8">
                {message}
              </Notice>
            ) : null}
          </div>
        </section>
      </Layout>
    );
  }

  const isLastStep = step === SURVEY_SECTIONS.length - 1;
  const percent = Math.round(((step + 1) / SURVEY_SECTIONS.length) * 100);

  return (
    <Layout title="Your feedback">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-xl">
          <p className="spx-eyebrow">Feedback</p>

          {step === 0 ? (
            <>
              <h1 className="mt-3">
                <span className="spx-display block">We&rsquo;d love</span>
                <span className="spx-display-serif block">your feedback.</span>
              </h1>
              <p className="spx-body mt-5">
                Thank you for using SharePix at {eventName || 'your event'}. Your candid
                feedback helps us make it easier, more useful and more valuable for the
                hosts and guests who come next.
              </p>
              <p className="spx-body mt-4">
                About five minutes. Please be honest — we are looking for what worked{' '}
                <em>and</em> what we should improve. Nothing here is required, and your
                answers save as you go.
              </p>
            </>
          ) : (
            <h1 className="mt-3">
              <span className="spx-display-serif block">{section.title}</span>
            </h1>
          )}

          {step > 0 && section.blurb ? <p className="spx-body mt-4">{section.blurb}</p> : null}

          {/* Progress. The bar is decorative; the text beside it is what a
              screen reader announces, so the two never disagree. */}
          <div className="mt-8">
            <div className="flex items-center justify-between text-sm text-charcoal/60">
              <span>{progressLabel(step + 1)}</span>
              <span>{percent}%</span>
            </div>
            <div
              className="mt-2 h-1.5 w-full bg-charcoal/10"
              role="progressbar"
              aria-valuenow={step + 1}
              aria-valuemin={1}
              aria-valuemax={SURVEY_SECTIONS.length}
              aria-label={`Step ${step + 1} of ${SURVEY_SECTIONS.length}`}
            >
              <div className="h-full bg-pine transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>

          <div className="mt-10 space-y-10">
            {visibleQuestions.map((question) => (
              <Question
                key={question.id}
                question={question}
                answers={answers}
                onChange={setAnswer}
              />
            ))}
          </div>

          <div className="mt-12 flex items-center justify-between gap-4 border-t border-charcoal/15 pt-6">
            <button
              type="button"
              onClick={previousStep}
              disabled={step === 0}
              className="min-h-[44px] px-2 text-sm font-medium text-charcoal/70 underline disabled:invisible"
            >
              Back
            </button>
            {isLastStep ? (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={phase === 'sending'}
                className="spx-btn-ink min-h-[44px] disabled:opacity-50"
              >
                {phase === 'sending' ? 'Sending…' : 'Send my feedback'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void nextStep()}
                className="spx-btn-ink min-h-[44px]"
              >
                Next
              </button>
            )}
          </div>

          <p className="mt-6 text-sm text-charcoal/60">
            Your answers are saved as you go. You can close this and come back to the same
            link.
          </p>
        </div>
      </section>
    </Layout>
  );
}

/** One question, rendered by kind. */
function Question({
  question,
  answers,
  onChange,
}: {
  question: SurveyQuestion;
  answers: SurveyAnswers;
  onChange: (id: string, value: SurveyAnswers[string]) => void;
}) {
  const value = answers[question.id];
  const otherId = `${question.id}Other`;

  // A radio or checkbox group is a fieldset with the prompt as its legend, so
  // the question is read out with each option rather than left to visual
  // proximity.
  if (question.kind === 'single' || question.kind === 'multi') {
    const chosen = question.kind === 'multi' ? (Array.isArray(value) ? value : []) : [];
    const showOther = (question.options ?? []).some(
      (option) =>
        option.withText &&
        (question.kind === 'multi' ? chosen.includes(option.value) : value === option.value),
    );

    return (
      <fieldset>
        <legend className="spx-body font-medium">{question.prompt}</legend>
        {question.kind === 'multi' ? (
          <p className="mt-1 text-sm text-charcoal/60">Choose as many as apply.</p>
        ) : null}
        <div className="mt-4 space-y-2">
          {(question.options ?? []).map((option) => {
            const checked =
              question.kind === 'multi' ? chosen.includes(option.value) : value === option.value;
            return (
              <label
                key={option.value}
                className={`flex min-h-[44px] cursor-pointer items-center gap-3 border px-4 py-3 transition ${
                  checked
                    ? 'border-ink bg-sage/40'
                    : 'border-charcoal/20 hover:border-charcoal/50'
                }`}
              >
                <input
                  type={question.kind === 'multi' ? 'checkbox' : 'radio'}
                  name={question.id}
                  value={option.value}
                  checked={checked}
                  onChange={() => {
                    if (question.kind === 'multi') {
                      onChange(
                        question.id,
                        checked
                          ? chosen.filter((entry) => entry !== option.value)
                          : [...chosen, option.value],
                      );
                    } else {
                      onChange(question.id, option.value);
                    }
                  }}
                />
                <span className="spx-body">{option.label}</span>
              </label>
            );
          })}
        </div>
        {showOther ? (
          <label className="mt-3 block">
            <span className="text-sm text-charcoal/60">Tell us which</span>
            <input
              type="text"
              value={typeof answers[otherId] === 'string' ? (answers[otherId] as string) : ''}
              onChange={(e) => onChange(otherId, e.target.value)}
              maxLength={MAX_OTHER_TEXT_LENGTH}
              className="spx-input mt-2 w-full"
            />
          </label>
        ) : null}
      </fieldset>
    );
  }

  if (question.kind === 'scale' || question.kind === 'nps') {
    const { min, max, minLabel, maxLabel } = question.scale!;
    const points = Array.from({ length: max - min + 1 }, (_, index) => min + index);
    return (
      <fieldset>
        <legend className="spx-body font-medium">{question.prompt}</legend>
        <div className="mt-4 flex flex-wrap gap-2" role="group">
          {points.map((point) => {
            const checked = value === point;
            return (
              <label
                key={point}
                className={`flex h-12 min-w-[44px] flex-1 cursor-pointer items-center justify-center border text-base font-semibold transition ${
                  checked ? 'border-ink bg-ink text-canvas' : 'border-charcoal/20 hover:border-charcoal'
                }`}
              >
                <input
                  type="radio"
                  name={question.id}
                  value={point}
                  checked={checked}
                  onChange={() => onChange(question.id, point)}
                  className="sr-only"
                />
                <span aria-hidden="true">{point}</span>
                <span className="sr-only">
                  {point} out of {max}
                </span>
              </label>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-sm text-charcoal/60">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      </fieldset>
    );
  }

  return (
    <label className="block">
      <span className="spx-body font-medium">{question.prompt}</span>
      <textarea
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(question.id, e.target.value)}
        rows={question.long ? 4 : 2}
        maxLength={MAX_TEXT_ANSWER_LENGTH}
        className="spx-input mt-3 w-full"
        placeholder="As much or as little as you like."
      />
    </label>
  );
}
