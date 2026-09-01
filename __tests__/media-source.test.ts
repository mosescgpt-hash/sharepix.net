import { initialSource, sourceAfterError } from '../lib/mediaSource';

const R2 = 'https://r2.example.com/photo.jpg?sig=1';
const S3 = 'https://s3.example.com/photo.jpg?sig=2';

describe('which URL to try first', () => {
  it('prefers the primary', () => {
    expect(initialSource({ primary: R2, fallback: S3 })).toBe(R2);
  });

  it('uses the fallback when there is no primary', () => {
    // R2 had nothing for this object, so the caller shouldn't have to notice.
    expect(initialSource({ primary: '', fallback: S3 })).toBe(S3);
  });

  it('is empty when there is nothing at all', () => {
    expect(initialSource({ primary: '' })).toBe('');
    expect(initialSource({ primary: '', fallback: null })).toBe('');
  });
});

describe('what to try after a failure', () => {
  it('moves from the primary to the fallback', () => {
    expect(sourceAfterError(R2, { primary: R2, fallback: S3 })).toBe(S3);
  });

  it('stops once the fallback has failed too', () => {
    // Null is the signal to stop. Returning S3 again would make onError set a
    // src that fails, fire onError, and loop as long as the page is open.
    expect(sourceAfterError(S3, { primary: R2, fallback: S3 })).toBeNull();
  });

  it('stops when there is no fallback', () => {
    expect(sourceAfterError(S3, { primary: S3 })).toBeNull();
    expect(sourceAfterError(S3, { primary: S3, fallback: null })).toBeNull();
    expect(sourceAfterError(S3, { primary: S3, fallback: '' })).toBeNull();
  });

  it('stops when both URLs are the same', () => {
    // Nothing would be gained by loading it again, and it would loop.
    expect(sourceAfterError(S3, { primary: S3, fallback: S3 })).toBeNull();
  });

  it('stops on a src that is neither, rather than guessing', () => {
    // The element was handed something from outside this pair; retrying our
    // fallback could fight whatever set it.
    expect(sourceAfterError('https://elsewhere/x.jpg', { primary: R2, fallback: S3 })).toBeNull();
  });

  it('never returns the same URL it was given', () => {
    const cases = [
      { primary: R2, fallback: S3 },
      { primary: S3, fallback: S3 },
      { primary: '', fallback: S3 },
      { primary: R2 },
    ];
    for (const source of cases) {
      for (const current of [R2, S3, '']) {
        expect(sourceAfterError(current, source)).not.toBe(current);
      }
    }
  });
});
