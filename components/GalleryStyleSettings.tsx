import { useEffect, useRef, useState } from 'react';
import EventCover from '@/components/EventCover';
import Notice from '@/components/Notice';
import {
  applyStarterLook,
  setEventCover,
  setEventEngagement,
  setEventGalleryAudience,
  setEventGalleryTheme,
  uploadEventCoverImage,
} from '@/lib/api';
import {
  COVER_PRESETS,
  DEFAULT_SHADE,
  MAX_COVER_SUBTITLE,
  MAX_COVER_TITLE,
  MAX_SHADE,
  MIN_SHADE,
  coverPresetFor,
  resolveEventCover,
  type CoverStyle,
  type ResolvedCover,
} from '@/lib/eventCover';
import {
  DEFAULT_FONT_SET,
  DEFAULT_GALLERY_LAYOUT,
  FONT_SETS,
  GALLERY_LAYOUTS,
  accentUse,
  fontSetFor,
  resolveGalleryTheme,
  themeStyle,
} from '@/lib/galleryTheme';
import { GALLERY_AUDIENCE_OPTIONS, galleryAudienceFor } from '@/lib/galleryAudience';
import { commentsEnabled, likesEnabled } from '@/lib/photoEngagement';
import { STARTER_LOOKS } from '@/lib/starterLooks';
import { eventTypeFor } from '@/lib/eventTypes';
import type { QREvent } from '@/lib/types';

const TABS = [
  { key: 'looks', label: 'Looks' },
  { key: 'cover', label: 'Cover' },
  { key: 'fonts', label: 'Fonts' },
  { key: 'gallery', label: 'Gallery' },
  { key: 'custom', label: 'Custom' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

interface Props {
  event: QREvent;
  /** Re-read the event after a save, so what is shown is what was stored. */
  onSaved: () => void;
}

/** What is stored, as the editable shape. */
function storedStyle(event: QREvent): CoverStyle {
  const cover = resolveEventCover(event);
  if (!cover.customized) return {};
  const style: CoverStyle = {
    preset: cover.preset.key,
    focus: cover.focus,
    shade: cover.shade,
    align: cover.align,
    height: cover.height,
    countdown: cover.countdown,
  };
  if (cover.image) style.image = cover.image;
  if (cover.title) style.title = cover.title;
  if (cover.subtitle) style.subtitle = cover.subtitle;
  return style;
}

/** The draft, resolved the way the pages will resolve it once saved. */
function draftCover(event: QREvent, draft: CoverStyle): ResolvedCover {
  return {
    image: draft.image ?? null,
    preset: coverPresetFor(draft.preset),
    tone: draft.image ? 'dark' : coverPresetFor(draft.preset).tone,
    focus: draft.focus ?? 50,
    shade: draft.shade ?? DEFAULT_SHADE,
    title: draft.title?.trim() || null,
    subtitle: draft.subtitle?.trim() || null,
    align: draft.align ?? 'center',
    height: draft.height ?? 'standard',
    countdown: draft.countdown ?? true,
    customized: Object.keys(draft).length > 0 || Boolean(event.coverStyle),
  };
}

/**
 * Where a host makes their event's pages look like their event.
 *
 * ## Tabs, and two levels within them
 *
 * The preview sits above a row of tabs, so whatever a host changes in any tab
 * shows up without scrolling back to check it.
 *
 *   **Looks, Cover, Fonts, Gallery** hold everything most hosts need, and none
 *   of it needs a decision: one-click starter looks (the ones that suit the
 *   event type first), "use my photo" or a
 *   background, the font cards, the gallery layout and likes and comments.
 *   Each saves the moment it is clicked.
 *
 *   **Custom** holds what is easy to get wrong without the preview in front of
 *   you — headline wording, where the photo is anchored, how dark the shade
 *   is, alignment, height, the countdown and a custom accent colour — edited
 *   as a draft and saved together. Its tab carries a dot while there are
 *   unsaved changes, so they are not left behind in a tab nobody is looking at.
 *
 * Choices are shown as what they look like rather than as their names: fonts
 * in their own typeface, layouts as a diagram, backgrounds as swatches, and
 * the whole thing in the preview at the top.
 */
export default function GalleryStyleSettings({ event, onSaved }: Props) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [accent, setAccent] = useState(event.galleryAccent ?? '');
  const [draft, setDraft] = useState<CoverStyle>(() => storedStyle(event));
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('looks');
  const fileInput = useRef<HTMLInputElement | null>(null);

  // A save re-reads the event; start the draft again from what was stored.
  useEffect(() => {
    setDraft(storedStyle(event));
  }, [event.coverStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAccent(event.galleryAccent ?? '');
  }, [event.galleryAccent]);

  useEffect(
    () => () => {
      if (localImage) URL.revokeObjectURL(localImage);
    },
    [localImage],
  );

  const currentFont = event.galleryFontSet ?? DEFAULT_FONT_SET;
  const currentLayout = event.galleryLayout ?? DEFAULT_GALLERY_LAYOUT;
  // What the accent will actually do, computed from the same rules the gallery
  // uses — so the warning below is the truth rather than a guess.
  const accentPreview = accentUse(accent);
  const cover = draftCover(event, draft);
  const stored = JSON.stringify(storedStyle(event));
  const draftChanged = JSON.stringify(draft) !== stored;
  // The preview shows the draft accent too, so a colour can be judged before
  // it is saved.
  const previewTheme = themeStyle(
    resolveGalleryTheme({ ...event, galleryAccent: accentPreview?.color ?? null }),
  );

  async function run(field: string, work: () => Promise<void>, done?: string) {
    setWorking(field);
    setError(null);
    setSaved(null);
    try {
      await work();
      if (done) setSaved(done);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be saved.');
    } finally {
      setWorking(null);
    }
  }

  /** Save the cover now, with `changes` on top of what is stored. */
  function saveCover(changes: Partial<CoverStyle>, field: string) {
    const next: CoverStyle = { ...storedStyle(event), ...changes };
    for (const key of Object.keys(next) as (keyof CoverStyle)[]) {
      if (next[key] === undefined) delete next[key];
    }
    setDraft(next);
    return run(field, () => setEventCover(event.id, next), 'Saved.');
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose a photo — a JPEG, PNG or HEIC from your camera roll.');
      return;
    }
    const preview = URL.createObjectURL(file);
    setLocalImage(preview);
    await run('photo', async () => {
      const key = await uploadEventCoverImage(event.id, file);
      // A new photo starts centred: wherever the last one was anchored says
      // nothing about this one.
      const next: CoverStyle = { ...storedStyle(event), image: key, focus: 50 };
      setDraft(next);
      await setEventCover(event.id, next);
    }, 'Cover photo saved. If faces are cut off, drag "Photo position" in the Custom tab.');
  }

  function applyLook(lookKey: string) {
    const look = STARTER_LOOKS.find((l) => l.key === lookKey);
    if (!look) return;
    void run(
      `look-${look.key}`,
      // The look's background, behind a photo if the host has one — it never
      // removes their photo.
      () => applyStarterLook(event.id, look, storedStyle(event)),
      `“${look.label}” applied.`,
    );
  }

  // The looks that suit this kind of event come first, under their own label;
  // the rest follow. An event created before the question sees them in order.
  const eventKind = eventTypeFor(event.eventType);
  const suggested = eventKind
    ? eventKind.looks
        .map((key) => STARTER_LOOKS.find((l) => l.key === key))
        .filter((l): l is (typeof STARTER_LOOKS)[number] => Boolean(l))
    : [];
  const otherLooks = STARTER_LOOKS.filter((l) => !suggested.includes(l));

  const set = (changes: Partial<CoverStyle>) => setDraft((d) => ({ ...d, ...changes }));
  const working_ = working !== null;

  function renderLook(look: (typeof STARTER_LOOKS)[number]) {
    const fonts = fontSetFor(look.galleryFontSet);
    const active =
      currentFont === look.galleryFontSet &&
      (event.galleryAccent ?? '') === look.galleryAccent &&
      resolveEventCover(event).preset.key === look.coverPreset;
    return (
      <button
        key={look.key}
        type="button"
        disabled={working_}
        onClick={() => applyLook(look.key)}
        aria-pressed={active}
        className={`overflow-hidden border text-left transition disabled:opacity-50 ${
          active ? 'border-ink ring-1 ring-ink' : 'border-charcoal/20 hover:border-charcoal/50'
        }`}
      >
        <span
          className={`block px-3 py-4 ${
            coverPresetFor(look.coverPreset).tone === 'light' ? 'text-ink' : 'text-canvas'
          }`}
          style={{ background: coverPresetFor(look.coverPreset).background }}
        >
          <span className="block text-lg leading-tight" style={{ fontFamily: fonts.heading }}>
            {look.label}
          </span>
        </span>
        <span className="block px-3 py-2 text-xs text-charcoal/60">
          {working === `look-${look.key}` ? 'Applying…' : look.description}
        </span>
      </button>
    );
  }

  return (
    <div className="spx-card p-5">
      <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Look and feel</h2>
      <p className="mt-1 text-sm text-charcoal/70">
        The top of your event pages — the first thing guests see after scanning — and how the
        gallery looks. The upload button and instructions stay as they are, so nothing gets
        harder to use.
      </p>

      {error ? (
        <Notice tone="warn" className="mt-3">
          {error}
        </Notice>
      ) : null}
      {saved ? (
        <Notice tone="success" className="mt-3">
          {saved}
        </Notice>
      ) : null}

      {/* The preview is the draft: what guests will see once it is saved. */}
      <div className="mt-5 overflow-hidden border border-charcoal/15">
        <div style={previewTheme} className="spx-themed-event">
          <EventCover event={event} cover={cover} imageSrc={localImage} preview>
            <span className="spx-btn-canvas pointer-events-none">Add your photos</span>
          </EventCover>
        </div>
      </div>
      <p className="mt-2 text-xs text-charcoal/55">
        Preview. Guests see this at the top of the upload page and the gallery.
      </p>

      {/* Tabs rather than one long scroll. The preview above stays put, so a
          change in any tab is seen without scrolling back up to check it. */}
      <div
        role="tablist"
        aria-label="Look and feel"
        className="-mx-5 mt-6 flex overflow-x-auto border-b border-charcoal/15 px-5"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const i = TABS.findIndex((t) => t.key === tab);
          const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
          setTab(next.key);
          document.getElementById(`look-tab-${next.key}`)?.focus();
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`look-tab-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`look-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              tab === t.key
                ? 'border-ink text-charcoal'
                : 'border-transparent text-charcoal/55 hover:text-charcoal'
            }`}
          >
            {t.label}
            {/* Unsaved custom options are easy to leave behind in a tab you
                cannot see, so the tab says so. */}
            {t.key === 'custom' && draftChanged ? (
              <span aria-label="unsaved changes" className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="pt-5">
      {tab === 'looks' ? (
        <div role="tabpanel" id="look-panel-looks" aria-labelledby="look-tab-looks">
          <fieldset className="">
            <legend className="text-xs uppercase tracking-wide text-charcoal/55">
              Start with a look
            </legend>
            <p className="mt-1 text-xs text-charcoal/60">
              Fonts, colour and background that go together, in one click. Change any part of it
              afterwards.
            </p>
            {suggested.length > 0 ? (
              <>
                <p className="mt-4 text-xs font-medium text-charcoal">
                  Suggested for {eventKind!.label.toLowerCase()}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {suggested.map(renderLook)}
                </div>
                <p className="mt-5 text-xs font-medium text-charcoal">More looks</p>
              </>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {otherLooks.map(renderLook)}
            </div>
          </fieldset>
        </div>
      ) : null}

      {tab === 'cover' ? (
        <div role="tabpanel" id="look-panel-cover" aria-labelledby="look-tab-cover">
          <fieldset className="">
            <legend className="text-xs uppercase tracking-wide text-charcoal/55">Cover</legend>
            <p className="mt-1 text-xs text-charcoal/60">
              Your own photo — the two of you, the venue, last year&rsquo;s party — or a background.
              Wide photos work best.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void choosePhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={working_}
                onClick={() => fileInput.current?.click()}
                className="bg-ink px-4 py-2 text-sm font-medium text-canvas disabled:opacity-50"
              >
                {working === 'photo' ? 'Uploading…' : cover.image ? 'Change photo' : 'Use my photo'}
              </button>
              {cover.image ? (
                <button
                  type="button"
                  disabled={working_}
                  onClick={() => {
                    setLocalImage(null);
                    void saveCover({ image: undefined }, 'remove-photo');
                  }}
                  className="text-sm text-charcoal/60 underline disabled:opacity-50"
                >
                  Remove photo
                </button>
              ) : null}
            </div>

            <p className="mt-4 text-xs text-charcoal/60">
              {cover.image ? 'Background, if you remove the photo:' : 'Or a background:'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {COVER_PRESETS.map((preset) => {
                const active = cover.preset.key === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    disabled={working_}
                    onClick={() => void saveCover({ preset: preset.key }, `preset-${preset.key}`)}
                    aria-pressed={active}
                    aria-label={preset.label}
                    title={preset.label}
                    className={`h-10 w-14 border-2 transition disabled:opacity-50 ${
                      active
                        ? 'border-ink ring-2 ring-ink/30'
                        : preset.tone === 'light'
                          ? 'border-charcoal/15 hover:border-charcoal/40'
                          : 'border-transparent hover:border-charcoal/40'
                    }`}
                    style={{ background: preset.background }}
                  />
                );
              })}
            </div>
          </fieldset>

          {cover.image ? (
            <p className="mt-4 text-xs text-charcoal/60">
              Faces cut off, or the words hard to read?{' '}
              <button
                type="button"
                onClick={() => setTab('custom')}
                className="font-medium text-pine underline"
              >
                Adjust the photo position and shade
              </button>
              .
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === 'fonts' ? (
        <div role="tabpanel" id="look-panel-fonts" aria-labelledby="look-tab-fonts">
          <fieldset className="">
            <legend className="text-xs uppercase tracking-wide text-charcoal/55">Fonts</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {FONT_SETS.map((fontSet) => (
                <button
                  key={fontSet.key}
                  type="button"
                  disabled={working_}
                  onClick={() =>
                    void run('font', () => setEventGalleryTheme(event.id, { galleryFontSet: fontSet.key }))
                  }
                  aria-pressed={currentFont === fontSet.key}
                  className={`border p-4 text-left transition disabled:opacity-50 ${
                    currentFont === fontSet.key
                      ? 'border-ink bg-ink/5'
                      : 'border-charcoal/20 hover:border-charcoal/50'
                  }`}
                >
                  {/* Set in its own font. The point of the choice is what it looks
                      like, and a list of names in one typeface hides exactly that. */}
                  <span
                    className="block text-xl leading-tight text-charcoal"
                    style={{ fontFamily: fontSet.heading }}
                  >
                    {fontSet.label}
                  </span>
                  <span className="mt-1 block text-xs text-charcoal/60">{fontSet.description}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}

      {tab === 'gallery' ? (
        <div role="tabpanel" id="look-panel-gallery" aria-labelledby="look-tab-gallery">
          <fieldset>
            <legend className="text-xs uppercase tracking-wide text-charcoal/55">
              Who can see the gallery
            </legend>
            <div className="mt-3 space-y-2">
              {GALLERY_AUDIENCE_OPTIONS.map((option) => {
                const active = galleryAudienceFor(event) === option.key;
                return (
                  <label
                    key={option.key}
                    className={`flex cursor-pointer items-start gap-3 border p-3 transition ${
                      active ? 'border-ink bg-ink/5' : 'border-charcoal/20 hover:border-charcoal/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gallery-audience"
                      className="mt-1"
                      checked={active}
                      disabled={working_}
                      onChange={() =>
                        void run(
                          'audience',
                          () => setEventGalleryAudience(event.id, option.key),
                          'Saved. You always see every photo yourself.',
                        )
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-charcoal">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-charcoal/60">
                        {option.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {galleryAudienceFor(event) !== 'everyone' ? (
              // What this does and does not do, said before a host relies on it.
              <p className="mt-3 text-xs text-charcoal/60">
                {galleryAudienceFor(event) === 'own'
                  ? 'A guest’s “own” photos are the ones uploaded from the same phone and browser, or while signed in. Photos from before October 2026 can’t be matched to a guest, so only you see those. '
                  : ''}
                Open the live slideshow signed in as yourself so it shows everything. Share links
                you create still work: they show exactly the photos you put in them.
              </p>
            ) : null}
          </fieldset>

          <fieldset className="mt-6">
            <legend className="text-xs uppercase tracking-wide text-charcoal/55">Gallery layout</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {GALLERY_LAYOUTS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  disabled={working_}
                  onClick={() =>
                    void run('layout', () => setEventGalleryTheme(event.id, { galleryLayout: option.key }))
                  }
                  aria-pressed={currentLayout === option.key}
                  className={`border p-4 text-left transition disabled:opacity-50 ${
                    currentLayout === option.key
                      ? 'border-ink bg-ink/5'
                      : 'border-charcoal/20 hover:border-charcoal/50'
                  }`}
                >
                  <LayoutSketch layout={option.key} />
                  <span className="mt-2 block text-sm font-medium text-charcoal">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-charcoal/60">{option.description}</span>
                </button>
              ))}
            </div>
          </fieldset>


          <fieldset className="mt-6">
            <legend className="text-xs uppercase tracking-wide text-charcoal/55">
              Likes and comments
            </legend>
            <p className="mt-1 text-xs text-charcoal/60">
              {/* Naming the case rather than leaving a host to work it out. A like
                  button under a photograph at a celebration of life is the wrong
                  object in the room, and that is not ours to decide for them. */}
              On by default. Some events are better without them — a memorial, for instance.
            </p>
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-3 text-sm text-charcoal">
                <input
                  type="checkbox"
                  checked={likesEnabled(event)}
                  disabled={working_}
                  onChange={(e) =>
                    void run('likes', () =>
                      setEventEngagement(event.id, { reactionsEnabled: e.target.checked }),
                    )
                  }
                />
                Guests can like photos
              </label>
              <label className="flex items-center gap-3 text-sm text-charcoal">
                <input
                  type="checkbox"
                  checked={commentsEnabled(event)}
                  disabled={working_}
                  onChange={(e) =>
                    void run('comments', () =>
                      setEventEngagement(event.id, { commentsEnabled: e.target.checked }),
                    )
                  }
                />
                Guests can comment on photos
              </label>
            </div>
            <p className="mt-2 text-xs text-charcoal/55">
              {/* Said plainly rather than implied. */}
              Comments are not screened automatically. You can hide any of them from your dashboard,
              and turning comments off hides the ones already there.
            </p>
          </fieldset>
        </div>
      ) : null}

      {tab === 'custom' ? (
        <div role="tabpanel" id="look-panel-custom" aria-labelledby="look-tab-custom">
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-charcoal">
                Headline
                <input
                  type="text"
                  value={draft.title ?? ''}
                  maxLength={MAX_COVER_TITLE}
                  placeholder={event.name}
                  onChange={(e) => set({ title: e.target.value || undefined })}
                  className="spx-input mt-1"
                />
                <span className="mt-1 block text-xs text-charcoal/55">
                  Blank uses your event&rsquo;s name.
                </span>
              </label>
              <label className="block text-sm text-charcoal">
                Line underneath
                <input
                  type="text"
                  value={draft.subtitle ?? ''}
                  maxLength={MAX_COVER_SUBTITLE}
                  placeholder="June 14, 2026 · Minneapolis"
                  onChange={(e) => set({ subtitle: e.target.value || undefined })}
                  className="spx-input mt-1"
                />
                <span className="mt-1 block text-xs text-charcoal/55">
                  Blank shows the date and place.
                </span>
              </label>
            </div>

            {cover.image ? (
              <label className="block text-sm text-charcoal">
                Photo position
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={cover.focus}
                  onChange={(e) => set({ focus: Number(e.target.value) })}
                  className="mt-2 block w-full"
                  aria-valuetext={`${cover.focus}% from the top`}
                />
                <span className="flex justify-between text-xs text-charcoal/55">
                  <span>Show the top</span>
                  <span>Show the bottom</span>
                </span>
              </label>
            ) : null}

            {cover.image ? (
              <label className="block text-sm text-charcoal">
                Shade over the photo
                <input
                  type="range"
                  min={MIN_SHADE}
                  max={MAX_SHADE}
                  value={cover.shade}
                  onChange={(e) => set({ shade: Number(e.target.value) })}
                  className="mt-2 block w-full"
                  aria-valuetext={`${cover.shade}%`}
                />
                <span className="flex justify-between text-xs text-charcoal/55">
                  <span>Lighter</span>
                  <span>Darker, easier to read</span>
                </span>
              </label>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <ChoiceRow
                label="Text alignment"
                value={cover.align}
                options={[
                  { value: 'center', label: 'Centred' },
                  { value: 'left', label: 'Left' },
                ]}
                onChange={(align) => set({ align: align as CoverStyle['align'] })}
              />
              <ChoiceRow
                label="Height"
                value={cover.height}
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'standard', label: 'Standard' },
                  { value: 'tall', label: 'Tall' },
                ]}
                onChange={(height) => set({ height: height as CoverStyle['height'] })}
              />
            </div>

            <label className="flex items-start gap-3 text-sm text-charcoal">
              <input
                type="checkbox"
                checked={cover.countdown}
                onChange={(e) => set({ countdown: e.target.checked })}
                className="mt-1"
              />
              <span>
                Show a countdown
                <span className="block text-xs text-charcoal/55">
                  &ldquo;3 days to go&rdquo; before the event, then how long guests have left to
                  share. Hidden once uploads close.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={working_ || !draftChanged}
                onClick={() => void run('cover', () => setEventCover(event.id, draft), 'Saved.')}
                className="bg-ink px-4 py-2 text-sm font-medium text-canvas disabled:opacity-40"
              >
                {working === 'cover' ? 'Saving…' : 'Save these options'}
              </button>
              {draftChanged ? (
                <button
                  type="button"
                  onClick={() => setDraft(storedStyle(event))}
                  className="text-sm text-charcoal/60 underline"
                >
                  Undo changes
                </button>
              ) : null}
              {event.coverStyle ? (
                <button
                  type="button"
                  disabled={working_}
                  onClick={() => {
                    if (!window.confirm('Remove your cover photo and options, and go back to the SharePix navy?')) return;
                    setLocalImage(null);
                    void run('reset', () => setEventCover(event.id, null), 'Cover reset.');
                  }}
                  className="ml-auto text-sm text-charcoal/60 underline disabled:opacity-50"
                >
                  Reset cover
                </button>
              ) : null}
            </div>

            <fieldset className="border-t border-charcoal/10 pt-4">
              <legend className="text-sm text-charcoal">Accent colour</legend>
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
                  disabled={working_ || accent.trim() === (event.galleryAccent ?? '')}
                  onClick={() =>
                    void run('accent', () =>
                      setEventGalleryTheme(event.id, { galleryAccent: accent.trim() }),
                    )
                  }
                  className="border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-40"
                >
                  {working === 'accent' ? 'Saving…' : 'Save colour'}
                </button>
                {event.galleryAccent ? (
                  <button
                    type="button"
                    disabled={working_}
                    onClick={() => {
                      setAccent('');
                      void run('accent', () => setEventGalleryTheme(event.id, { galleryAccent: '' }));
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
                  (contrast {accentPreview.contrast}:1). It will be used for rules and highlights,
                  and words will stay in the readable dark ink.
                </p>
              ) : null}
            </fieldset>
          </div>
        </div>
      ) : null}
      </div>

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

/** A small set of mutually exclusive choices, as buttons. */
function ChoiceRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="text-sm text-charcoal">
      {label}
      <div className="mt-1 flex">
        {options.map((option, i) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`flex-1 border px-3 py-2 text-sm ${i > 0 ? '-ml-px' : ''} ${
              value === option.value
                ? 'relative z-10 border-ink bg-ink text-canvas'
                : 'border-charcoal/25 text-charcoal hover:border-charcoal/50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
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
