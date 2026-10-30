import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GUEST_BOOK_CONSENT_LINE,
  GUEST_BOOK_VIDEO_CONSENT_LINE,
  attachmentFailureMessage,
  attachmentKind,
  noteFailureMessage,
  postSubmitNotice,
  videoWaitsForHost,
} from '../lib/guestBookAttach';

describe('guest book attachment helpers', () => {
  it('opens with the upload page’s own consent sentence, word for word', () => {
    const uploadForm = readFileSync(join(__dirname, '..', 'components', 'UploadForm.tsx'), 'utf8');
    const sentence = 'By uploading, you understand these photos and videos will be visible to other event guests.';
    expect(uploadForm).toContain(sentence);
    expect(GUEST_BOOK_CONSENT_LINE.startsWith(sentence)).toBe(true);
  });

  it('tells guests that videos go to the host first', () => {
    expect(GUEST_BOOK_VIDEO_CONSENT_LINE).toMatch(/host first/);
  });

  it('tells a video from a photo by extension or MIME type', () => {
    expect(attachmentKind({ name: 'a.jpg', type: 'image/jpeg' })).toBe('photo');
    expect(attachmentKind({ name: 'a.HEIC' })).toBe('photo');
    expect(attachmentKind({ name: 'clip.mov', type: 'video/quicktime' })).toBe('video');
    expect(attachmentKind({ name: 'clip.mp4' })).toBe('video');
    expect(attachmentKind({ name: 'recording', type: 'video/webm' })).toBe('video');
  });

  it('expects a video to wait for the host unless the host allows everything', () => {
    expect(videoWaitsForHost('review')).toBe(true);
    expect(videoWaitsForHost(undefined)).toBe(true);
    expect(videoWaitsForHost('allow_all')).toBe(false);
  });

  it('only adds a post-submit notice when something is actually waiting', () => {
    expect(postSubmitNotice({ pending: false, attached: null })).toBeNull();
    expect(postSubmitNotice({ pending: false, attached: 'photo' })).toBeNull();
    expect(postSubmitNotice({ pending: false, attached: 'video', moderationMode: 'allow_all' })).toBeNull();
    expect(postSubmitNotice({ pending: false, attached: 'video', moderationMode: 'review' })).toMatch(
      /video will show once the host approves it/,
    );
    expect(postSubmitNotice({ pending: true, attached: 'video' })).toMatch(/note and video/);
  });

  it('says a failed upload keeps the note, and a failed note does not re-send the file', () => {
    expect(attachmentFailureMessage('video')).toMatch(/note is still here/);
    expect(attachmentFailureMessage('photo', 'Network down.')).toMatch(/^Network down\./);
    expect(noteFailureMessage('photo', 'Rate limited.')).toMatch(/already uploaded and will not be sent again/);
  });
});
