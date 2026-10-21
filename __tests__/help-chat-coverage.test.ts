import { answerQuestion } from '../lib/helpChat';
import { codeOnly, readSource } from './sourceGuards';

const all = { commentsOn: true, featuredOffered: true };

describe('the help chat answers everyday host questions', () => {
  // The first answer for each. If a new article or a wording change pushes one
  // of these down, the chat has got worse for a question hosts really ask.
  const cases: [string, string][] = [
    ['how do i add my photographer', 'add-photographer'],
    ['what is booth mode', 'booth-mode'],
    ['how do i set up a trade show booth', 'booth-mode'],
    ['how do i change the cover photo', 'change-the-look'],
    ['change the fonts', 'change-the-look'],
    ['make the gallery private', 'gallery-privacy'],
    ['turn off likes', 'likes-and-comments'],
    ['delete a comment', 'likes-and-comments'],
    ['how do photo challenges work', 'photo-challenges'],
    ['send guests reminders', 'guest-reminders'],
    ['what are moments', 'moments'],
    ['nfc tags', 'nfc-tags'],
    ['guest book', 'guest-book'],
    ['how do i delete several photos at once', 'host-delete-photo'],
    ['delete my event', 'host-delete-photo'],
    ['feature my event', 'featured-events'],
    ['change my event date', 'edit-event-details'],
    ['photographer watermark', 'photographer-using-pro'],
    ['where are my headshots', 'booth-mode'],
    ['unsubscribe from booth emails', 'booth-photos-for-attendees'],
    ['how do i stop people downloading photos', 'host-guest-downloads'],
    ['live slideshow on a tv', 'live-slideshow'],
    ['close uploads', 'host-close-event'],
  ];
  it.each(cases)('"%s" → %s', (question, slug) => {
    expect(answerQuestion(question, all).articles[0]?.slug).toBe(slug);
  });

  it('offers a shortcut only when it matches most of the question', () => {
    expect(answerQuestion('guest book', all).jumps).toEqual([]);
    expect(answerQuestion('turn off likes', all).jumps.map((j) => j.key)).toEqual(['layout']);
  });
});

describe("deleting an event from the host's dashboard", () => {
  const api = codeOnly(readSource('lib/api.ts'));
  const host = api.slice(
    api.indexOf('export async function deleteEventWithPhotos'),
    api.indexOf('async function deleteAllEventPhotos'),
  );

  it('removes the row through removeHostedEvent, which hosts are allowed to call', () => {
    expect(host).toContain('await deleteMyEvent(eventId)');
    expect(host).not.toContain('models.Event.delete');
  });

  it('keeps the photos of an event SharePix closed or is reviewing', () => {
    expect(host).toMatch(/if \(!preserved\) await deleteAllEventPhotos\(eventId\);/);
    expect(host).toContain('needsContentReview(');
  });
});
