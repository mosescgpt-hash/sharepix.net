import { ReactNode } from 'react';

export type NoticeTone = 'info' | 'warn' | 'error' | 'success';

/**
 * The one way this site tells a guest something.
 *
 * The old pages each hand-rolled their own — `bg-red-50`, `bg-amber-50`,
 * `bg-mint/40`, `bg-smoke`, all rounded pills, all slightly different. In the
 * redesign a notice is square, sits on the page rather than floating above it,
 * and carries its meaning in a left rule and a label rather than a pastel
 * wash. That keeps it legible on the warm ground, where pale fills disappear.
 *
 * `error` and `warn` get role="alert" so a screen reader is told when one
 * appears mid-flow. `info` and `success` do not — announcing every incidental
 * note interrupts the person for no reason.
 */
const TONES: Record<NoticeTone, { rule: string; label: string; labelText: string }> = {
  info: { rule: 'border-l-charcoal/25', label: 'text-charcoal/50', labelText: '' },
  // Amber and red come from Tailwind's default palette rather than the brand
  // tokens: the palette has no warning colour, and inventing one out of `pine`
  // or `mint` would make a warning look like a success.
  warn: { rule: 'border-l-amber-600', label: 'text-amber-700', labelText: 'Heads up' },
  error: { rule: 'border-l-red-700', label: 'text-red-700', labelText: 'Problem' },
  success: { rule: 'border-l-pine', label: 'text-pine', labelText: 'Done' },
};

interface NoticeProps {
  tone?: NoticeTone;
  /** Overrides the tone's default label. Pass an empty string for no label. */
  label?: string;
  className?: string;
  children: ReactNode;
}

export default function Notice({ tone = 'info', label, className = '', children }: NoticeProps) {
  const style = TONES[tone];
  const heading = label ?? style.labelText;
  const urgent = tone === 'error' || tone === 'warn';

  return (
    <div
      role={urgent ? 'alert' : undefined}
      className={`border border-charcoal/10 border-l-2 ${style.rule} bg-paper px-5 py-4 ${className}`}
    >
      {heading ? (
        <p
          className={`font-sans text-[0.7rem] font-medium uppercase tracking-[0.16em] ${style.label}`}
        >
          {heading}
        </p>
      ) : null}
      <div className={`text-sm leading-relaxed text-charcoal/75 ${heading ? 'mt-1.5' : ''}`}>
        {children}
      </div>
    </div>
  );
}
