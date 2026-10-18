import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import {
  getCurrentUserInfo,
  getMyPhotographerProfileForm,
  refreshProWatermarks,
  saveMyPhotographerProfile,
} from '@/lib/api';
import {
  EMPTY_PROFILE,
  LINK_FIELDS,
  MAX_NAME_LENGTH,
  MAX_WATERMARK_LENGTH,
  PREVIEW_SIZE_OPTIONS,
  prepareProfile,
  watermarkChanged,
  type PhotographerProfileForm,
} from '@/lib/photographerProfile';
import {
  MAX_LOGO_DATA_URL_LENGTH,
  MAX_WATERMARK_OPACITY,
  MIN_WATERMARK_OPACITY,
  WATERMARK_POSITIONS,
  watermarkSpec,
  type WatermarkPosition,
  type WatermarkStyle,
} from '@/lib/watermark';
import { galleryLinksFor } from '@/lib/professionalMedia';

type Problems = Partial<Record<keyof PhotographerProfileForm, string>>;

/**
 * A photographer's profile: the credit, links and watermark that go on their
 * shots in every event gallery, and what happens to their originals.
 *
 * One form, one Save, because these are read together when a photo is
 * processed. A preview on the right shows what a guest will see on a tile, so
 * the links are checked by looking rather than by trusting.
 */
export default function ProProfilePage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [form, setForm] = useState<PhotographerProfileForm>(EMPTY_PROFILE);
  const [saved, setSaved] = useState<PhotographerProfileForm>(EMPTY_PROFILE);
  const [problems, setProblems] = useState<Problems>({});
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const user = await getCurrentUserInfo().catch(() => null);
      setSignedIn(Boolean(user));
      if (!user) return;
      try {
        const profile = await getMyPhotographerProfileForm();
        if (profile) {
          setForm(profile.form);
          setSaved(profile.form);
        }
      } catch (err) {
        setStatus({
          tone: 'error',
          text: err instanceof Error ? err.message : 'Your profile could not be loaded.',
        });
      }
    })();
  }, []);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof PhotographerProfileForm>(key: K, value: PhotographerProfileForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setStatus(null);
  };

  async function save() {
    const prepared = prepareProfile(form);
    if (!prepared.ok) {
      setProblems(prepared.problems);
      setStatus({ tone: 'error', text: 'Fix the highlighted fields, then save.' });
      return;
    }
    setProblems({});
    setSaving(true);
    try {
      await saveMyPhotographerProfile(prepared.value);
      const redo = watermarkChanged(prepared.value, saved);
      setForm(prepared.value);
      setSaved(prepared.value);
      let text = 'Saved. Your name and links are updated on all your photos.';
      if (redo) {
        // The watermark is burned into each preview, so changing it means
        // redoing them; that runs in the background.
        try {
          text = `Saved. ${await refreshProWatermarks()}`;
        } catch (err) {
          text = err instanceof Error ? err.message : 'Saved, but your photos could not be updated yet.';
        }
      }
      setStatus({ tone: 'success', text });
    } catch (err) {
      setStatus({
        tone: 'error',
        text: err instanceof Error ? err.message : 'That could not be saved. Nothing changed.',
      });
    } finally {
      setSaving(false);
    }
  }

  // What a guest sees under one of your shots, from what is in the boxes now.
  const previewLinks = galleryLinksFor({
    website: prepareLinkForPreview(form.website),
    contactUrl: prepareLinkForPreview(form.contactUrl),
    purchaseGalleryUrl: prepareLinkForPreview(form.purchaseGalleryUrl),
  });
  // The same rules the server stamps with, so the sample below is honest.
  const previewSpec = watermarkSpec(form);

  async function chooseLogo(file: File | undefined) {
    if (!file) return;
    try {
      const logo = await shrinkLogo(file);
      set('watermarkLogo', logo);
      if (form.watermarkStyle === 'text') set('watermarkStyle', 'both');
      setProblems((current) => ({ ...current, watermarkLogo: undefined }));
    } catch {
      setProblems((current) => ({
        ...current,
        watermarkLogo: 'That image could not be used. Try a PNG or JPEG.',
      }));
    }
  }

  return (
    <Layout title="Your photographer profile">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-2xl">
          <p className="spx-eyebrow">
            <Link href="/pro" className="underline">
              SharePix Pro
            </Link>
          </p>
          <h1 className="mt-3">
            <span className="spx-display block">Your profile,</span>
            <span className="spx-display-serif block">on every shot.</span>
          </h1>
          <p className="spx-body mt-5">
            Your name and links appear under each of your photos in every event gallery you
            shoot, and your watermark on every preview. Changes show on photos you have
            already posted too.
          </p>

          {signedIn === false ? (
            <p className="mt-8 border border-dashed border-charcoal/25 p-6 text-center text-sm text-charcoal/60">
              <Link href="/my-events" className="font-medium text-pine underline">
                Sign in
              </Link>{' '}
              to set up your profile.
            </p>
          ) : signedIn === null ? (
            <p className="mt-8 text-sm text-charcoal/55">Loading&hellip;</p>
          ) : (
            <form
              className="mt-8 space-y-8"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <fieldset>
                <legend className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-charcoal/55">
                  Credit and links
                </legend>
                <Field
                  label="Name shown on your photos"
                  hint="Your business name. Shown as “Photo by …”."
                  problem={problems.businessName}
                >
                  <input
                    value={form.businessName}
                    maxLength={MAX_NAME_LENGTH}
                    onChange={(e) => set('businessName', e.target.value)}
                    placeholder="Rivera Photography"
                    className="spx-input mt-1 w-full"
                  />
                </Field>
                {LINK_FIELDS.map((field) => (
                  <Field key={field.key} label={field.label} hint={field.hint} problem={problems[field.key]}>
                    <input
                      type="url"
                      inputMode="url"
                      value={form[field.key]}
                      onChange={(e) => set(field.key, e.target.value)}
                      placeholder="https://"
                      className="spx-input mt-1 w-full"
                    />
                  </Field>
                ))}
              </fieldset>

              <fieldset>
                <legend className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-charcoal/55">
                  Watermark
                </legend>
                <label className="mt-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={form.watermarkEnabled}
                    onChange={(e) => set('watermarkEnabled', e.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Watermark my previews</span>
                    <span className="mt-1 block text-charcoal/65">
                      Added to the previews guests see, never to your original files.
                    </span>
                  </span>
                </label>
                {form.watermarkEnabled ? (
                  <div className="mt-2 space-y-4">
                    <Field label="Show">
                      <select
                        value={form.watermarkStyle}
                        onChange={(e) => set('watermarkStyle', e.target.value as WatermarkStyle)}
                        className="spx-input mt-1 w-full sm:w-60"
                      >
                        <option value="text">Text</option>
                        <option value="logo">Logo</option>
                        <option value="both">Logo and text</option>
                      </select>
                    </Field>
                    {form.watermarkStyle !== 'logo' ? (
                      <Field
                        label="Watermark text"
                        hint="Leave empty to use the name above."
                        problem={problems.watermarkText}
                      >
                        <input
                          value={form.watermarkText}
                          maxLength={MAX_WATERMARK_LENGTH}
                          onChange={(e) => set('watermarkText', e.target.value)}
                          placeholder={form.businessName || '© Your name'}
                          className="spx-input mt-1 w-full"
                        />
                      </Field>
                    ) : null}
                    {form.watermarkStyle !== 'text' ? (
                      <div>
                        <span className="text-sm font-medium">Logo</span>
                        <div className="mt-1 flex flex-wrap items-center gap-3">
                          {form.watermarkLogo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={form.watermarkLogo}
                              alt="Your logo"
                              className="h-12 max-w-[10rem] border border-charcoal/15 bg-charcoal/10 object-contain p-1"
                            />
                          ) : null}
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            onChange={(e) => void chooseLogo(e.target.files?.[0])}
                            className="text-sm"
                          />
                          {form.watermarkLogo ? (
                            <button
                              type="button"
                              onClick={() => set('watermarkLogo', '')}
                              className="text-sm text-charcoal/60 underline"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        <span className={`mt-1 block text-xs ${problems.watermarkLogo ? 'text-red-700' : 'text-charcoal/60'}`}>
                          {problems.watermarkLogo ??
                            'A PNG with a transparent background looks best. It is resized for you.'}
                        </span>
                      </div>
                    ) : null}
                    <Field label="Position">
                      <select
                        value={form.watermarkPosition}
                        onChange={(e) => set('watermarkPosition', e.target.value as WatermarkPosition)}
                        className="spx-input mt-1 w-full sm:w-60"
                      >
                        {WATERMARK_POSITIONS.map((position) => (
                          <option key={position} value={position}>
                            {POSITION_LABELS[position]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={`Opacity: ${form.watermarkOpacity}%`}>
                      <input
                        type="range"
                        min={MIN_WATERMARK_OPACITY}
                        max={MAX_WATERMARK_OPACITY}
                        step={5}
                        value={form.watermarkOpacity}
                        onChange={(e) => set('watermarkOpacity', Number(e.target.value))}
                        className="mt-2 w-full sm:w-72"
                      />
                    </Field>
                  </div>
                ) : null}
              </fieldset>

              <fieldset>
                <legend className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-charcoal/55">
                  Your files
                </legend>
                <Field
                  label="Preview size"
                  hint="The long edge of the preview guests see. Bigger looks better; smaller is less useful to anyone hoping to skip buying the file."
                >
                  <select
                    value={form.previewLongEdge}
                    onChange={(e) => set('previewLongEdge', Number(e.target.value))}
                    className="spx-input mt-1 w-full sm:w-60"
                  >
                    {PREVIEW_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size} pixels{size === 1800 ? ' (recommended)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="mt-5 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={form.keepOriginals}
                    onChange={(e) => set('keepOriginals', e.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Keep my original files</span>
                    <span className="mt-1 block text-charcoal/65">
                      Off by default: we make the preview and delete the original. Originals
                      are never shown or offered to guests either way.
                    </span>
                  </span>
                </label>
              </fieldset>

              <div className="border border-charcoal/15 bg-paper p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-charcoal/55">
                  What guests see under your photos
                </p>
                <div className="mt-3 text-sm">
                  <WatermarkSample spec={previewSpec} />
                  <p className="text-charcoal/60">
                    {form.businessName.trim()
                      ? `Photo by ${form.businessName.trim()}`
                      : 'No credit — add your name above.'}
                  </p>
                  {previewLinks.length > 0 ? (
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {previewLinks.map((link) => (
                        <a
                          key={link.label}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-pine underline"
                        >
                          {link.label}
                        </a>
                      ))}
                    </p>
                  ) : (
                    <p className="mt-1 text-charcoal/55">No links yet.</p>
                  )}
                </div>
              </div>

              {status ? <Notice tone={status.tone}>{status.text}</Notice> : null}

              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={saving || !dirty} className="spx-btn-ink disabled:opacity-40">
                  {saving ? 'Saving…' : 'Save profile'}
                </button>
                <Link href="/pro" className="text-sm text-charcoal/70 underline">
                  Back to your events
                </Link>
              </div>
            </form>
          )}
        </div>
      </section>
    </Layout>
  );
}

const POSITION_LABELS: Record<WatermarkPosition, string> = {
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
  'top-left': 'Top left',
  'top-right': 'Top right',
  center: 'Centre',
};

/**
 * A logo, downscaled in the browser to something small enough to store on the
 * profile: at most 600 pixels wide, PNG to keep transparency, smaller still if
 * the file is too big.
 */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    for (const maxWidth of [600, 400, 280]) {
      const scale = Math.min(1, maxWidth / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png');
      if (data.length <= MAX_LOGO_DATA_URL_LENGTH) return data;
    }
    throw new Error('too big');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A stand-in photo with the watermark where the server will put it. */
function WatermarkSample({ spec }: { spec: ReturnType<typeof watermarkSpec> }) {
  if (!spec) return <p className="mb-2 text-xs text-charcoal/55">No watermark on your previews.</p>;
  const pos = spec.position;
  const place =
    pos === 'center'
      ? 'inset-0 items-center justify-center text-center'
      : `${pos.startsWith('top') ? 'top-[3%]' : 'bottom-[3%]'} ${
          pos.endsWith('right') ? 'right-[3%] items-end text-right' : 'left-[3%] items-start text-left'
        }`;
  return (
    <div className="relative mb-3 aspect-[3/2] w-full max-w-md overflow-hidden bg-gradient-to-br from-slate-500 to-slate-700">
      <div className={`absolute flex flex-col gap-1 ${place}`} style={{ opacity: spec.opacity }}>
        {spec.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={spec.logo} alt="" className="w-24 object-contain sm:w-28" />
        ) : null}
        {spec.text ? <span className="text-sm font-medium text-white">{spec.text}</span> : null}
      </div>
    </div>
  );
}

/** A bare domain previews as the https link it will be saved as. */
function prepareLinkForPreview(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
}

function Field({
  label,
  hint,
  problem,
  children,
}: {
  label: string;
  hint?: string;
  problem?: string;
  children: ReactNode;
}) {
  return (
    <label className="mt-4 block">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {problem ? (
        <span className="mt-1 block text-xs text-red-700">{problem}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-charcoal/60">{hint}</span>
      ) : null}
    </label>
  );
}
