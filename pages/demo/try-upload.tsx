import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { uploadData } from 'aws-amplify/storage';

import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import PhotoGrid from '@/components/PhotoGrid';
import { demoGallery, sampleImageNotice } from '@/lib/demoEvent';
import {
  DEMO_ACCEPT_ATTRIBUTE,
  DEMO_MAX_UPLOADS,
  DEMO_PROMISE,
  checkDemoFile,
  demoExpiresAt,
  demoKeyFor,
  demoRetentionNote,
  newDemoSessionId,
} from '@/lib/demoUpload';
import type { DisplayPhoto } from '@/lib/types';

/**
 * "Try an upload yourself" — the sample gallery, with the visitor's own photo
 * in it.
 *
 * The most persuasive thing this site can do. The product's whole argument is
 * that contributing is easier than people expect, and ten seconds holding their
 * own phone makes that case better than any paragraph.
 *
 * ## The photo on screen is local; the upload is real
 *
 * What the grid shows is an object URL for the File the visitor just picked, so
 * it appears instantly and at full quality with no round trip. Behind it the
 * file is genuinely uploaded to S3 and genuinely passes through
 * `sanitize-upload` — sniffed, size-capped, location stripped — because a demo
 * that only pretended to upload would be a lie told on the page that sells
 * carefulness.
 *
 * Nothing ever reads the stored copy back. There is no page, no query and no
 * signed URL that serves the `demo/` prefix, and `storage/resource.ts` grants
 * no read on it to anybody, including admins. That is why the promise is "there
 * is no page anywhere that shows it" rather than "only you can see it": the
 * second is a rule somebody has to keep enforcing, and the first is a fact
 * about there being nowhere to look.
 *
 * ## Why the copy does not say "deleted when you leave"
 *
 * Because it could not be delivered. These visitors are on phones; a tab gets
 * discarded, an app gets switched, `beforeunload` never fires. `demo-cleanup`
 * sweeps the prefix every fifteen minutes and that is the guarantee — see
 * lib/demoUpload.ts.
 */
export default function TryUploadPage() {
  const sample = demoGallery('wedding');
  // One id per visit, made in the browser, meaning nothing. It exists so a
  // visitor's own uploads sit together under one key prefix.
  const sessionRef = useRef<string>('');
  if (!sessionRef.current) sessionRef.current = newDemoSessionId();

  const [mine, setMine] = useState<MyUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const inputRef = useRef<HTMLInputElement>(null);

  // Drives the countdown beside each photo, so the promise is visibly being
  // kept rather than asserted once at the top of the page.
  useEffect(() => {
    if (mine.length === 0) return;
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [mine.length]);

  // Object URLs are a leak if they outlive the component. Revoked together on
  // unmount rather than per-photo, because a photo is never removed from this
  // list while the page is open.
  useEffect(() => {
    return () => {
      for (const upload of mine) URL.revokeObjectURL(upload.localUrl);
    };
    // Intentionally on unmount only; `mine` is read through the closure at
    // teardown, which is the set that needs revoking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPhoto = useCallback(async (file: File) => {
    setError(null);
    const verdict = checkDemoFile(file, countOf());
    if (!verdict.ok) {
      setError(verdict.reason);
      return;
    }

    const uploadedAt = new Date();
    const localUrl = URL.createObjectURL(file);
    const id = `mine-${uploadedAt.getTime()}`;
    // On screen immediately, before a byte has moved. Waiting for the upload to
    // finish before showing anything would make the product look slower than it
    // is, and the upload's real progress is shown underneath.
    setMine((current) => [
      ...current,
      { id, localUrl, uploadedAt, expiresAt: demoExpiresAt(uploadedAt), state: 'uploading' },
    ]);

    try {
      const key = demoKeyFor(sessionRef.current, file.type, countOf());
      await uploadData({
        path: key,
        data: file,
        options: { contentType: file.type },
      }).result;
      setMine((current) =>
        current.map((item) => (item.id === id ? { ...item, state: 'stored' } : item)),
      );
    } catch {
      // The photo stays on screen — it is the visitor's own file and removing
      // it would look like their photo was rejected. Only the status changes.
      setMine((current) =>
        current.map((item) => (item.id === id ? { ...item, state: 'failed' } : item)),
      );
    }

    function countOf() {
      return mineRef.current.length;
    }
  }, []);

  // A ref alongside the state so the cap counts what is actually there, rather
  // than a value captured when the handler was created.
  const mineRef = useRef<MyUpload[]>([]);
  useEffect(() => {
    mineRef.current = mine;
  }, [mine]);

  const photos: DisplayPhoto[] = useMemo(() => {
    const yours = mine.map((upload, index) => ({
      id: upload.id,
      eventId: sample.event.id,
      s3Key: '',
      uploadedBy: 'You',
      caption: 'Your photo',
      createdAt: upload.uploadedAt.toISOString(),
      url: upload.localUrl,
      order: index,
    })) as unknown as DisplayPhoto[];
    // Newest first, so the photo they just added is the one they see.
    return [...yours, ...sample.photos];
  }, [mine, sample.event.id, sample.photos]);

  return (
    <Layout title="Try an upload" width="bleed">
      <section className="spx-section-ink py-10 sm:py-14">
        <div className="spx-inner">
          <p className="spx-eyebrow">Try it yourself</p>
          <h1 className="spx-display mt-3">Add a photo to this gallery.</h1>
          <p className="spx-display-serif mt-1 text-2xl sm:text-3xl">
            It takes about five seconds.
          </p>
          <p className="mt-5 max-w-xl text-sm text-canvas/80">
            This is what a guest at your event does. No app, no account, nothing to
            explain — pick a photo and watch it land.
          </p>
        </div>
      </section>

      <section className="spx-section-canvas py-10 sm:py-14">
        <div className="spx-inner">
          <div className="spx-card p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-sans text-lg font-semibold">
                  {mine.length === 0 ? 'Add your own photo' : 'Add another'}
                </p>
                <p className="spx-body mt-1 max-w-xl text-sm">{DEMO_PROMISE}</p>
              </div>
              <div className="shrink-0">
                <input
                  ref={inputRef}
                  type="file"
                  accept={DEMO_ACCEPT_ATTRIBUTE}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // Cleared so picking the same file twice still fires.
                    event.target.value = '';
                    if (file) void addPhoto(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={mine.length >= DEMO_MAX_UPLOADS}
                  className="spx-btn-ink w-full disabled:opacity-50 sm:w-auto"
                >
                  {mine.length >= DEMO_MAX_UPLOADS ? 'That is enough to see it' : 'Choose a photo'}
                </button>
              </div>
            </div>

            {error ? (
              <p className="mt-4 border border-charcoal/10 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            {mine.length > 0 ? (
              <ul className="mt-5 space-y-1 border-t border-charcoal/10 pt-4 text-sm">
                {mine.map((upload) => (
                  <li key={upload.id} className="flex flex-wrap items-center gap-x-2 text-charcoal/70">
                    <span className="font-medium text-charcoal">Your photo</span>
                    <span>·</span>
                    <span>{statusLabel(upload.state)}</span>
                    <span>·</span>
                    <span>{demoRetentionNote(upload.expiresAt, now)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <Notice label="This is a sample" className="mt-8">
            {sampleImageNotice(sample.isPhotography)}{' '}
            Your own photo is the only real one here, and it is gone within the hour.{' '}
            <Link href="/create-event" className="text-pine underline">
              Create your own event
            </Link>{' '}
            to keep them.
          </Notice>

          <div className="mt-8">
            {/* The real grid, not an imitation of it. A hand-built copy would
                drift from the product and start misrepresenting it — the same
                reasoning as the sample gallery page. */}
            <PhotoGrid
              photos={photos}
              eventName={sample.event.name}
              canDownload={false}
              canOrderPrints={false}
            />
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/create-event" className="spx-btn-ink">
              Create an event gallery
            </Link>
            <Link href="/demo" className="spx-btn-outline">
              See the rest of the demo
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}

interface MyUpload {
  id: string;
  /** An object URL for the visitor's own File. Never a URL to our storage. */
  localUrl: string;
  uploadedAt: Date;
  expiresAt: Date;
  state: 'uploading' | 'stored' | 'failed';
}

function statusLabel(state: MyUpload['state']): string {
  if (state === 'uploading') return 'Uploading…';
  if (state === 'stored') return 'Uploaded';
  // Deliberately not alarming: the photo is on screen, it is theirs, and the
  // demo has already made its point. A red failure here would be the last
  // impression of a page about how well this works.
  return 'Shown here only — the upload did not complete';
}
