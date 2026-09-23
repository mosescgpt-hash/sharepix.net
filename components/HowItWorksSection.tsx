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
}: {
  first?: string;
  second?: string;
}) {
  return (
    <section className="spx-section-ink">
      <div className="spx-inner">
        <p className="spx-eyebrow">How it works</p>
        <SectionHeading first={first} second={second} />
        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <div key={step.n}>
              <div className="spx-step-icon bg-canvas/15 text-canvas">
                <span className="spx-numeral text-lg">{step.n}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
              <p className="spx-body mt-2 text-sm">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
