import { useEffect, useState } from 'react';
import {
  addPhotoComment,
  listPhotoComments,
  togglePhotoLike,
  type PhotoCommentRow,
} from '@/lib/api';
import {
  MAX_COMMENT_LENGTH,
  commentLabel,
  likeLabel,
} from '@/lib/photoEngagement';

interface Props {
  photoId: string;
  eventId: string;
  guestKey: string;
  /** What this guest is called, so a comment can be signed without typing. */
  guestLabel: string;
  likesOn: boolean;
  commentsOn: boolean;
  /** The count as stored. Adjusted locally while a tap is in flight. */
  likeCount: number;
  liked: boolean;
  onLikedChange: (liked: boolean) => void;
}

/**
 * The like button and comment thread under one photo.
 *
 * Lives in the lightbox rather than on the grid card. Looking at one photo is
 * when a person has something to say about it; a comment box under every
 * thumbnail is a wall of boxes, and a tap target on a card competes with
 * selecting and downloading — the two things a guest came to do.
 *
 * ## Optimistic, but only about the heart
 *
 * The like flips immediately and is put back if the write fails, because a
 * heart that waits for a round trip feels broken on venue wifi. Comments are
 * NOT optimistic: a comment that appears and then vanishes is worse than one
 * that takes a second, and the person is already looking at the box.
 */
export default function PhotoEngagement({
  photoId,
  eventId,
  guestKey,
  guestLabel,
  likesOn,
  commentsOn,
  likeCount,
  liked,
  onLikedChange,
}: Props) {
  const [comments, setComments] = useState<PhotoCommentRow[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The stored count plus this browser's own un-saved change, so the number
  // beside the heart agrees with the heart.
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    if (!commentsOn) return;
    let live = true;
    void listPhotoComments(eventId).then((rows) => {
      if (live) setComments(rows.filter((row) => row.photoId === photoId && !row.hidden));
    });
    return () => {
      live = false;
    };
  }, [eventId, photoId, commentsOn]);

  // A new photo is a new count. Without this the delta from the last photo
  // would follow the viewer along the gallery.
  useEffect(() => setDelta(0), [photoId]);

  async function handleLike() {
    const next = !liked;
    onLikedChange(next);
    setDelta((d) => d + (next ? 1 : -1));
    try {
      const stored = await togglePhotoLike(photoId, guestKey);
      // Trust what the server says over what we guessed — they differ when a
      // tap raced another tab, or when the row already existed.
      onLikedChange(stored);
      setDelta(stored === next ? (next ? 1 : -1) : 0);
    } catch {
      onLikedChange(!next);
      setDelta(0);
    }
  }

  async function handleComment() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await addPhotoComment({ photoId, guestKey, body, author: guestLabel });
      setDraft('');
      const rows = await listPhotoComments(eventId);
      setComments(rows.filter((row) => row.photoId === photoId && !row.hidden));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be posted.');
    } finally {
      setSending(false);
    }
  }

  const shownLikes = Math.max(0, likeCount + delta);

  if (!likesOn && !commentsOn) return null;

  return (
    <div className="border-t border-white/15 px-4 py-3 text-white">
      {likesOn ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleLike}
            aria-pressed={liked}
            aria-label={liked ? 'Remove your like' : 'Like this photo'}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
              liked ? 'bg-white text-charcoal' : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            <span aria-hidden>{liked ? '♥' : '♡'}</span>
            {shownLikes > 0 ? likeLabel(shownLikes) : 'Like'}
          </button>
          {commentsOn && comments && comments.length > 0 ? (
            <span className="text-sm text-white/60">{commentLabel(comments.length)}</span>
          ) : null}
        </div>
      ) : null}

      {commentsOn ? (
        <div className="mt-3">
          {comments === null ? (
            <p className="text-sm text-white/50">Loading comments&hellip;</p>
          ) : comments.length > 0 ? (
            <ul className="mb-3 max-h-40 space-y-2 overflow-y-auto pr-1">
              {comments.map((comment) => (
                <li key={comment.id} className="text-sm">
                  <span className="font-medium text-white/90">
                    {comment.author || 'A guest'}
                  </span>{' '}
                  {/* Rendered as a text node, never as markup. */}
                  <span className="text-white/75">{comment.body}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              maxLength={MAX_COMMENT_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !sending) void handleComment();
              }}
              placeholder={`Say something as ${guestLabel}`}
              aria-label="Write a comment"
              className="min-w-0 flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/50 focus:outline-none"
            />
            <button
              type="button"
              disabled={sending || !draft.trim()}
              onClick={() => void handleComment()}
              className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-medium text-charcoal transition hover:bg-white/90 disabled:opacity-40"
            >
              {sending ? 'Posting…' : 'Post'}
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
