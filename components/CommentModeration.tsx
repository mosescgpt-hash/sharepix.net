import { useCallback, useEffect, useState } from 'react';
import Notice from '@/components/Notice';
import { getCurrentUserInfo, listPhotoComments, setPhotoCommentHidden } from '@/lib/api';
import type { PhotoCommentRow } from '@/lib/api';

/**
 * Every comment on this event's photos, and the host's power over them.
 *
 * This exists because nothing screens comments. Photo screening is Rekognition;
 * text screening is a different service with a different cost and its own
 * failure modes, and implying a filter that does not exist would be worse than
 * giving the host a real one. So the host is the filter, and they need to be
 * able to see everything in one place rather than by opening photos one at a
 * time.
 *
 * Hidden, not deleted. A host who hides something in the moment can change
 * their mind, and the count on the photo stays reconcilable either way.
 */
export default function CommentModeration({ eventId }: { eventId: string }) {
  const [comments, setComments] = useState<PhotoCommentRow[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setComments(await listPhotoComments(eventId));
      setError(null);
    } catch (err) {
      setComments([]);
      setError(err instanceof Error ? err.message : 'Comments could not be loaded.');
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(comment: PhotoCommentRow) {
    setWorking(comment.id);
    setError(null);
    try {
      const me = await getCurrentUserInfo();
      await setPhotoCommentHidden(comment.id, !comment.hidden, me?.loginId ?? 'host');
      setComments((current) =>
        (current ?? []).map((row) =>
          row.id === comment.id ? { ...row, hidden: !row.hidden } : row,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be updated.');
    } finally {
      setWorking(null);
    }
  }

  const hiddenCount = (comments ?? []).filter((row) => row.hidden).length;

  return (
    <div className="spx-card p-5">
      <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Comments</h2>
      <p className="mt-1 text-sm text-charcoal/70">
        Everything guests have written on your photos. Nothing is screened automatically,
        so this is where you see it all. Hiding a comment removes it from the gallery and
        can be undone.
      </p>

      {error ? (
        <Notice tone="warn" className="mt-3">
          {error}
        </Notice>
      ) : null}

      {comments === null ? (
        <p className="mt-4 text-sm text-charcoal/55">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="mt-4 text-sm text-charcoal/55">Nobody has commented yet.</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-charcoal/55">
            {comments.length} total{hiddenCount > 0 ? `, ${hiddenCount} hidden` : ''}
          </p>
          <ul className="mt-3 divide-y divide-charcoal/10 border-y border-charcoal/10">
            {comments.map((comment) => (
              <li key={comment.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className={`text-sm ${comment.hidden ? 'text-charcoal/40' : 'text-charcoal'}`}>
                    <span className="font-medium">{comment.author || 'A guest'}</span>{' '}
                    {comment.body}
                  </p>
                  {comment.hidden ? (
                    <p className="mt-0.5 text-xs text-charcoal/50">
                      Hidden — guests do not see this.
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={working === comment.id}
                  onClick={() => void toggle(comment)}
                  className="shrink-0 border border-charcoal/25 px-3 py-2 text-xs font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                >
                  {comment.hidden ? 'Show' : 'Hide'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
