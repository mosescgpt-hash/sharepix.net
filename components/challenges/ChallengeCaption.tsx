/** The challenge a slideshow photo answered, under the uploader's name. */
export default function ChallengeCaption({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="mt-1 truncate text-lg text-white/85 drop-shadow">
      <span className="text-white/60">Challenge:</span> {text}
    </p>
  );
}
