import SectionHeading from '@/components/SectionHeading';
import { HOW_IT_WORKS_STEPS } from '@/lib/howItWorks';

/**
 * The three-step "how it works" block, shared by the homepage and every
 * use-case landing page.
 *
 * Only the heading varies by caller — the steps themselves come from
 * `lib/howItWorks.ts` and are never typed out twice, so a landing page can
 * never describe a different process than the homepage does.
 */
export default function HowItWorksSection({
  first = 'Three steps.',
  second = "That's the whole thing.",
  compact = false,
}: {
  first?: string;
  second?: string;
  /** Tighter vertical spacing, for the homepage. */
  compact?: boolean;
}) {
  return (
    <section className={`spx-section-ink${compact ? ' !py-8 sm:!py-10' : ''}`}>
      <div className="spx-inner">
        <p className="spx-eyebrow">How it works</p>
        <SectionHeading first={first} second={second} compact={compact} />
        <div className={`grid sm:grid-cols-3 ${compact ? 'mt-5 gap-4 sm:gap-6' : 'mt-12 gap-10'}`}>
          {HOW_IT_WORKS_STEPS.map((step) =>
            compact ? (
              <div key={step.n} className="flex gap-4">
                <div className="spx-step-icon !h-10 !w-10 shrink-0 bg-canvas/15 text-canvas">
                  <span className="spx-numeral text-base">{step.n}</span>
                </div>
                <div>
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="spx-body mt-1 text-sm leading-snug">{step.body}</p>
                </div>
              </div>
            ) : (
              <div key={step.n}>
                <div className="spx-step-icon bg-canvas/15 text-canvas">
                  <span className="spx-numeral text-lg">{step.n}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                <p className="spx-body mt-2 text-sm">{step.body}</p>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
