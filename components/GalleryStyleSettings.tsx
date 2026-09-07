import { useState } from 'react';
import Notice from '@/components/Notice';
import { setEventGalleryTheme } from '@/lib/api';
import {
  DEFAULT_FONT_SET,
  DEFAULT_GALLERY_LAYOUT,
  FONT_SETS,
  GALLERY_LAYOUTS,
  accentUse,
  fontSetFor,
} from '@/lib/galleryTheme';
import type { QREvent } from '@/lib/types';

interface Props {
  event: QREvent;
  /** Re-read the event after a save, so what is shown is what was stored. */
  onSaved: () => void;
}

/**
 * Where a host makes the gallery look like their event.
 *
 * Three choices, shown as what they look like rather than as their names: the
 * font options are rendered IN their own font, and the layout options as a
 * small diagram. A host choosing "Elegant" from a dropdown of words is
 * guessing; a host reading the word "Elegant" set in Cormorant is choosing.
 *
 * Saving is per-field. Changing the layout says nothing about the fonts, so
 * each control writes only itself — a host who has set an accent and then picks
 * a layout does not lose the accent.
 */
export default function GalleryStyleSettings({ event, onSaved }: Props) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accent, setAccent] = useState(event.galleryAccent ?? '');

  const currentFont = event.galleryFontSet ?? DEFAULT_FONT_SET;
  const currentLayout = event.galleryLayout ?? DEFAULT_GALLERY_LAYOUT;
  // What the accent will actually do, computed from the same rules the gallery
  // uses — so the warning below is the truth rather than a guess.
  const accentPreview = accentUse(accent);

  async function save(field: string, changes: Parameters<typeof setEventGalleryTheme>[1]) {
    setWorking(field);
    setError(null);
    try {
      await setEventGalleryTheme(event.id, changes);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be saved.');
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="spx-card p-5">
      <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Gallery style</h2>
      <p className="mt-1 text-sm text-charcoal/70">
        How your gallery looks to guests. Everything else — the upload page, the buttons,
        the instructions — stays as it is, so nothing gets harder to use.
      </p>

      {error ? (
        <Notice tone="warn" className="mt-3">
          {error}
        </Notice>
      ) : null}

      <fieldset className="mt-6">
        <legend className="text-xs uppercase tracking-wide text-charcoal/55">Fonts</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {FONT_SETS.map((set) => (
            <button
              key={set.key}
              type="button"
              disabled={working !== null}
              onClick={() => void save('font', { galleryFontSet: set.key })}
              aria-pressed={currentFont === set.key}
              className={`border p-4 text-left transition disabled:opacity-50 ${
                currentFont === set.key
                  ? 'border-ink bg-ink/5'
                  : 'border-charcoal/20 hover:border-charcoal/50'
              }`}
            >
              {/* Set in its own font. The point of the choice is what it looks
                  like, and a list of names in one typeface hides exactly that. */}
              <span
                className="block text-xl leading-tight text-charcoal"
                style={{ fontFamily: set.heading }}
              >
                {set.label}
              </span>
              <span className="mt-1 block text-xs text-charcoal/60">{set.description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-xs uppercase tracking-wide text-charcoal/55">Layout</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {GALLERY_LAYOUTS.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={working !== null}
              onClick={() => void save('layout', { galleryLayout: option.key })}
              aria-pressed={currentLayout === option.key}
              className={`border p-4 text-left transition disabled:opacity-50 ${
                currentLayout === option.key
                  ? 'border-ink bg-ink/5'
                  : 'border-charcoal/20 hover:border-charcoal/50'
              }`}
            >
              <LayoutSketch layout={option.key} />
              <span className="mt-2 block text-sm font-medium text-charcoal">
                {option.label}
              </span>
              <span className="mt-0.5 block text-xs text-charcoal/60">{option.description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-xs uppercase tracking-wide text-charcoal/55">
          Accent colour
        </legend>
        <p className="mt-1 text-xs text-charcoal/60">
          Your event&rsquo;s colour, used for rules and highlights. Leave it blank for the
          SharePix palette.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="color"
            value={accentPreview?.color ?? '#123851'}
            onChange={(e) => setAccent(e.target.value)}
            aria-label="Pick an accent colour"
            className="h-10 w-14 cursor-pointer border border-charcoal/20 bg-paper p-1"
          />
          <input
            type="text"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            placeholder="#7B2D3B"
            aria-label="Accent colour hex value"
            className="spx-input w-36"
          />
          <button
            type="button"
            disabled={working !== null || accent.trim() === (event.galleryAccent ?? '')}
            onClick={() => void save('accent', { galleryAccent: accent.trim() })}
            className="border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-40"
          >
            {working === 'accent' ? 'Saving…' : 'Save colour'}
          </button>
          {event.galleryAccent ? (
            <button
              type="button"
              disabled={working !== null}
              onClick={() => {
                setAccent('');
                void save('accent', { galleryAccent: '' });
              }}
              className="text-sm text-charcoal/60 underline disabled:opacity-50"
            >
              Clear
            </button>
          ) : null}
        </div>

        {accentPreview && !accentPreview.usableForText ? (
          // Not an error and not a refusal. A pale blush might be exactly the
          // wedding's colour, and telling a host their colour is wrong helps
          // nobody — this says what will happen instead.
          <p className="mt-3 text-xs text-charcoal/70">
            That colour is too light to read as text on the gallery&rsquo;s background
            (contrast {accentPreview.contrast}:1). It will be used for rules and
            highlights, and words will stay in the readable dark ink.
          </p>
        ) : null}
      </fieldset>

      <p className="mt-6 text-xs text-charcoal/55">
        Changes are live straight away —{' '}
        <a className="font-medium text-pine underline" href={`/event/${event.id}`}>
          open your gallery
        </a>{' '}
        to see them.
      </p>
    </div>
  );
}

/** A small diagram of each layout, so the choice is visible rather than named. */
function LayoutSketch({ layout }: { layout: string }) {
  const block = 'bg-charcoal/25';
  if (layout === 'mosaic') {
    return (
      <span aria-hidden className="flex h-10 gap-1">
        <span className="flex flex-1 flex-col gap-1">
          <span className={`${block} h-6`} />
          <span className={`${block} flex-1`} />
        </span>
        <span className="flex flex-1 flex-col gap-1">
          <span className={`${block} h-3`} />
          <span className={`${block} flex-1`} />
        </span>
        <span className="flex flex-1 flex-col gap-1">
          <span className={`${block} flex-1`} />
          <span className={`${block} h-4`} />
        </span>
      </span>
    );
  }
  if (layout === 'feed') {
    return (
      <span aria-hidden className="flex h-10 flex-col items-center gap-1">
        <span className={`${block} h-5 w-2/3`} />
        <span className={`${block} h-4 w-2/3`} />
      </span>
    );
  }
  return (
    <span aria-hidden className="grid h-10 grid-cols-3 grid-rows-2 gap-1">
      {[...Array(6)].map((_, i) => (
        <span key={i} className={block} />
      ))}
    </span>
  );
}

/** Re-exported so the settings page can label the current choice. */
export { fontSetFor };
