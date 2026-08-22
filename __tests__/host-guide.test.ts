import { hostGuideSections } from '../lib/hostGuide';

describe('host guide sections', () => {
  it('always shows uploading and the brochure, in that order', () => {
    expect(hostGuideSections({})).toEqual(['upload', 'brochure']);
  });

  it('adds the live slideshow only once it is purchased', () => {
    expect(hostGuideSections({ liveSlideshowEnabled: false })).not.toContain('live');
    expect(hostGuideSections({ liveSlideshowEnabled: true })).toContain('live');
  });

  it('adds guest downloads only once they are enabled', () => {
    expect(hostGuideSections({ guestDownloadEnabled: false })).not.toContain('downloads');
    expect(hostGuideSections({ guestDownloadEnabled: true })).toContain('downloads');
  });

  it('keeps a stable order with everything on', () => {
    expect(
      hostGuideSections({ liveSlideshowEnabled: true, guestDownloadEnabled: true }),
    ).toEqual(['upload', 'brochure', 'live', 'downloads']);
  });
});
