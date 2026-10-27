import { ReactNode } from 'react';

interface SwitchRowProps {
  id?: string;
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

/**
 * An on/off choice as a whole tappable row: the label, what it does, and a
 * switch. The row is the button, so the target is the full width and at least
 * 44px tall on a phone, not just the small switch.
 */
export default function SwitchRow({ id, label, description, checked, disabled, onChange }: SwitchRowProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-[44px] w-full items-start justify-between gap-4 border border-charcoal/15 bg-paper p-4 text-left transition hover:border-charcoal/40 disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-charcoal">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-charcoal/70">{description}</span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={`relative mt-0.5 inline-block h-6 w-11 shrink-0 transition ${
          checked ? 'bg-pine' : 'bg-charcoal/25'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 bg-paper transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  );
}
