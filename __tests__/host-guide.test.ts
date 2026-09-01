import { hostGuideSections } from '../lib/hostGuide';

describe('host guide sections', () => {
  it('always shows uploading, the brochure and downloads, in that order', () => {
    expect(hostGuideSections({})).toEqual(['upload', 'brochure', 'downloads']);
  });

  it('adds the live slideshow only once it is purchased', () => {
    expect(hostGuideSections({ liveSlideshowEnabled: false })).not.toContain('live');
    expect(hostGuideSections({ liveSlideshowEnabled: true })).toContain('live');
  });

  it('always includes the downloads how-to, on any plan', () => {
    // Guest downloads are no longer an add-on, so the guidance always applies —
    // including on events that still carry the retired flag set to false.
    expect(hostGuideSections({})).toContain('downloads');
    expect(hostGuideSections({ guestDownloadEnabled: false })).toContain('downloads');
    expect(hostGuideSections({ guestDownloadEnabled: true })).toContain('downloads');
  });

  it('keeps a stable order with everything on', () => {
    expect(
      hostGuideSections({ liveSlideshowEnabled: true, guestDownloadEnabled: true }),
    ).toEqual(['upload', 'brochure', 'live', 'downloads']);
  });
});
