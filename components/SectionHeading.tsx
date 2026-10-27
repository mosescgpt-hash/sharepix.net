/** Headline line one bold sans, line two italic serif. The pairing is the brand. */
export default function SectionHeading({
  first,
  second,
  compact = false,
}: {
  first: string;
  second: string;
  /** A smaller headline, for pages that run tight (the homepage). */
  compact?: boolean;
}) {
  const size = compact ? ' !text-[1.65rem] sm:!text-4xl' : '';
  return (
    <h2 className="mt-2">
      <span className={`spx-display block${size}`}>{first}</span>
      <span className={`spx-display-serif block${size}`}>{second}</span>
    </h2>
  );
}
