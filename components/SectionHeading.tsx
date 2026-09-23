/** Headline line one bold sans, line two italic serif. The pairing is the brand. */
export default function SectionHeading({ first, second }: { first: string; second: string }) {
  return (
    <h2 className="mt-3">
      <span className="spx-display block">{first}</span>
      <span className="spx-display-serif block">{second}</span>
    </h2>
  );
}
