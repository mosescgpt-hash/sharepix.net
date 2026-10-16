import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { getCurrentUserInfo, getMyPhotographerProfileForm, saveMyPhotographerProfile } from '@/lib/api';
import {
  EMPTY_PROFILE,
  LINK_FIELDS,
  MAX_NAME_LENGTH,
  MAX_WATERMARK_LENGTH,
  PREVIEW_SIZE_OPTIONS,
  prepareProfile,
  type PhotographerProfileForm,
} from '@/lib/photographerProfile';
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
      setForm(prepared.value);
      setSaved(prepared.value);
      setStatus({
        tone: 'success',
        text: 'Saved. It applies to photos you upload from now on.',
      });
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
  const previewWatermark = form.watermarkEnabled
    ? (form.watermarkText.trim() || form.businessName.trim()).slice(0, MAX_WATERMARK_LENGTH)
    : '';

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
            shoot. Changes apply to photos you upload from now on — ones already in a gallery
            keep what they were uploaded with.
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
                  {previewWatermark ? (
                    <p className="mb-2 text-xs text-charcoal/55">
                      Watermark on the image: <span className="font-medium">{previewWatermark}</span>
                    </p>
                  ) : null}
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
