import { buildDownloadFilename } from '../lib/validation';

const KEY = 'events/abc/photos/deadbeef-img_1234.jpg';

describe('download filenames', () => {
  it('builds ###-Event-Uploader.ext', () => {
    expect(
      buildDownloadFilename({
        index: 1,
        eventName: 'Sam & Riley Wedding',
        uploadedBy: 'Aunt Maya',
        s3Key: KEY,
      }),
    ).toBe('001-Sam-Riley-Wedding-Aunt-Maya.jpg');
  });

  it('zero-pads so files sort in order, and widens past 999', () => {
    const at = (index: number) =>
      buildDownloadFilename({ index, eventName: 'E', uploadedBy: 'U', s3Key: KEY });
    expect(at(7)).toBe('007-E-U.jpg');
    expect(at(42)).toBe('042-E-U.jpg');
    expect(at(1000)).toBe('1000-E-U.jpg');
  });

  it('keeps the real extension, including video', () => {
    expect(
      buildDownloadFilename({ index: 2, eventName: 'E', uploadedBy: 'U', s3Key: 'events/a/photos/x.MOV' }),
    ).toBe('002-E-U.mov');
  });

  it('falls back to .jpg when the key has no usable extension', () => {
    expect(
      buildDownloadFilename({ index: 1, eventName: 'E', uploadedBy: 'U', s3Key: 'events/a/photos/noext' }),
    ).toBe('001-E-U.jpg');
  });

  it('omits pieces it does not have rather than writing "undefined"', () => {
    expect(buildDownloadFilename({ index: 3, s3Key: KEY })).toBe('003.jpg');
    expect(buildDownloadFilename({ eventName: 'Party', s3Key: KEY })).toBe('Party.jpg');
    expect(buildDownloadFilename({ index: 1, eventName: 'E', uploadedBy: '', s3Key: KEY })).toBe('001-E.jpg');
  });

  it('never produces an empty name', () => {
    expect(buildDownloadFilename({})).toBe('sharepix-photo.jpg');
    // A name made only of punctuation collapses to nothing — still safe.
    expect(buildDownloadFilename({ eventName: '***', uploadedBy: '///', s3Key: KEY })).toBe(
      'sharepix-photo.jpg',
    );
  });

  it('strips characters that are illegal in filenames or could traverse paths', () => {
    const name = buildDownloadFilename({
      index: 1,
      eventName: '../../etc/passwd',
      uploadedBy: 'a:b*c?d"e<f>g|h',
      s3Key: KEY,
    });
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).not.toContain('..');
  });

  it('bounds long names so the file is still usable', () => {
    const name = buildDownloadFilename({
      index: 1,
      eventName: 'E'.repeat(200),
      uploadedBy: 'U'.repeat(200),
      s3Key: KEY,
    });
    expect(name.length).toBeLessThanOrEqual(80);
  });
});
