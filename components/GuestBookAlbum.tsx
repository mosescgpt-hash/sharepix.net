import { FallbackImage, FallbackVideo } from '@/components/FallbackMedia';
import { isVideoFilename } from '@/lib/validation';
import type { GuestBookEntry } from '@/lib/types';

/**
 * What an attached entry needs in order to be shown: a URL to load from, an
 * optional fallback, and enough of the key to tell a video from a still.
 *
 * Deliberately narrower than DisplayPhoto so the demo can supply data URIs
 * without pretending to be a real photo record.
 */
export interface AlbumMedia {
  url: string;
  fallbackUrl?: string | null;
  /** Used only to decide <img> vs <video>. */
  s3Key: string;
}

/** Long dates read better than ISO strings on a keepsake page. */
function entryDate(value?: string | null): string {
  if (!value) return '';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * The album itself — the notes, in the order they were left.
 *
 * Shared by the real guest book and the public demo so the worked example
 * cannot drift from the thing it is an example of.
 */
export default function GuestBookAlbum({
  entries,
  mediaFor,
}: {
  entries: GuestBookEntry[];
  mediaFor: (photoId: string) => AlbumMedia | undefined;
}) {
  if (entries.length === 0) {
    return (
      <div className="spx-empty">
        <p className="spx-display-serif text-2xl">No notes yet.</p>
        <p className="spx-body mt-2 text-sm">Yours would be the first.</p>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-center font-serif text-2xl italic text-charcoal">
        {entries.length} {entries.length === 1 ? 'note' : 'notes'}
      </h2>
      <ul className="mt-8 space-y-6">
        {entries.map((entry) => {
          const media = entry.photoId ? mediaFor(entry.photoId) : undefined;
          const isVideo = media ? isVideoFilename(media.s3Key) : false;
          return (
            <li key={entry.id} className="spx-card overflow-hidden">
              {media ? (
                <div className="bg-sand">
                  {isVideo ? (
                    <FallbackVideo
                      source={{ primary: media.url, fallback: media.fallbackUrl }}
                      controls
                      playsInline
                      preload="metadata"
                      className="max-h-96 w-full bg-night object-contain"
                    />
                  ) : (
                    <FallbackImage
                      source={{ primary: media.url, fallback: media.fallbackUrl }}
                      alt={`Attached by ${entry.name}`}
                      loading="lazy"
                      className="max-h-96 w-full object-contain"
                    />
                  )}
                </div>
              ) : null}
              <div className="p-6 sm:p-7">
                {entry.message ? (
                  // Plain text, rendered as text. React escapes it; nothing
                  // here ever builds HTML out of something a guest typed.
                  <p className="whitespace-pre-line leading-relaxed text-ink/85">
                    {entry.message}
                  </p>
                ) : (
                  <p className="font-serif italic text-charcoal/70">
                    {isVideo ? 'Left a video message.' : 'Left a photo.'}
                  </p>
                )}
                <p className="mt-5 text-sm text-charcoal/60">
                  <span className="font-sans font-semibold text-charcoal">
                    {entry.name}
                  </span>
                  {entryDate(entry.createdAt) ? (
                    <span> · {entryDate(entry.createdAt)}</span>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
