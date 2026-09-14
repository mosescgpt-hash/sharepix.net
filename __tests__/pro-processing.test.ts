import {
  ACCEPTED_INPUT_MIMES,
  KEEP_ORIGINALS_CHANGE_NOTE,
  KEEP_ORIGINALS_EXPLANATION,
  MAX_INPUT_BYTES,
  canProcess,
  discardDecision,
  isAcceptedInput,
  scaleToLongEdge,
  watermarkFor,
} from '../lib/proProcessing';

describe('never destroy a photographer’s only copy', () => {
  // The rule this module exists for. A photographer at a wedding may have
  // formatted the card already; deleting on a failure path does not degrade
  // the photograph, it destroys it.
  const done = { previewWritten: true, thumbnailWritten: true };

  it('discards once both derivatives are confirmed written', () => {
    const decision = discardDecision(done);
    expect(decision.discard).toBe(true);
    expect(decision.reason).toBe('replaced-by-derivatives');
  });

  it('keeps the original when processing failed', () => {
    // It is the only thing left to retry from.
    const decision = discardDecision({ ...done, failed: true });
    expect(decision.discard).toBe(false);
    expect(decision.reason).toBe('processing-failed');
  });

  it('keeps the original when either derivative is missing', () => {
    for (const state of [
      { previewWritten: true, thumbnailWritten: false },
      { previewWritten: false, thumbnailWritten: true },
      { previewWritten: false, thumbnailWritten: false },
    ]) {
      const decision = discardDecision(state);
      expect(decision.discard).toBe(false);
      expect(decision.reason).toBe('derivatives-incomplete');
    }
  });

  it('keeps the original when the photographer opted in', () => {
    const decision = discardDecision({ ...done, keepOriginal: true });
    expect(decision.discard).toBe(false);
    expect(decision.reason).toBe('photographer-opted-in');
  });

  it('puts failure ahead of the opt-in, so neither answer can discard', () => {
    expect(discardDecision({ ...done, failed: true, keepOriginal: true }).discard).toBe(false);
    expect(
      discardDecision({ previewWritten: false, thumbnailWritten: false, failed: true }).discard,
    ).toBe(false);
  });

  it('treats an absent opt-in as the default, which is discard', () => {
    for (const keepOriginal of [undefined, null, false]) {
      expect(discardDecision({ ...done, keepOriginal }).discard).toBe(true);
    }
  });
});

describe('what the photographer is told about it', () => {
  it('says what happens by default, not only what the option does', () => {
    expect(KEEP_ORIGINALS_EXPLANATION).toMatch(/delete your original/i);
    expect(KEEP_ORIGINALS_EXPLANATION).toMatch(/tick this/i);
  });

  it('promises that turning it off does not delete what is already held', () => {
    // A preference change is not a request to destroy files.
    expect(KEEP_ORIGINALS_CHANGE_NOTE).toMatch(/from now on/i);
    expect(KEEP_ORIGINALS_CHANGE_NOTE).toMatch(/stay until you delete them/i);
  });
});

describe('which files can be processed', () => {
  it('accepts the formats the decoder actually handles', () => {
    expect([...ACCEPTED_INPUT_MIMES].sort()).toEqual(['image/jpeg', 'image/png']);
    expect(isAcceptedInput('image/jpeg')).toBe(true);
    expect(isAcceptedInput('IMAGE/PNG')).toBe(true);
  });

  it('rejects WebP rather than half-writing a preview', () => {
    // The decoder does not support it. No camera emits WebP, so this costs
    // nothing real — but silently failing would.
    expect(isAcceptedInput('image/webp')).toBe(false);
    expect(canProcess({ bytes: 100, mime: 'image/webp' }).reason).toBe('format');
  });

  it('names the formats that work when it refuses one', () => {
    // The person reading it is mid-upload and wants to know what to do next.
    const message = canProcess({ bytes: 100, mime: 'image/webp' }).message;
    expect(message).toMatch(/JPEG/);
    expect(message).toMatch(/PNG/);
  });

  it('rejects anything that is not an image at all', () => {
    for (const mime of [null, undefined, '', 'text/html', 'application/pdf', 'image/svg+xml']) {
      expect(canProcess({ bytes: 100, mime }).ok).toBe(false);
    }
  });

  it('rejects an empty file', () => {
    expect(canProcess({ bytes: 0, mime: 'image/jpeg' }).reason).toBe('unreadable');
  });

  it('caps input size before anything is decoded', () => {
    // Jimp decodes to raw RGBA, so memory is width x height x 4 whatever the
    // file compressed to. One panorama must not take the processor down for
    // everybody else on the event.
    expect(canProcess({ bytes: MAX_INPUT_BYTES + 1, mime: 'image/jpeg' }).reason).toBe(
      'too-large',
    );
    expect(canProcess({ bytes: MAX_INPUT_BYTES, mime: 'image/jpeg' }).ok).toBe(true);
  });

  it('caps pixel count when dimensions are known', () => {
    expect(
      canProcess({ bytes: 1000, mime: 'image/jpeg', width: 20000, height: 20000 }).reason,
    ).toBe('too-many-pixels');
  });

  it('accepts when dimensions are not yet known', () => {
    // They are only readable once the header is parsed; the byte cap runs first.
    expect(canProcess({ bytes: 1000, mime: 'image/jpeg' }).ok).toBe(true);
    expect(canProcess({ bytes: 1000, mime: 'image/jpeg', width: null, height: null }).ok).toBe(
      true,
    );
  });
});

describe('scaling', () => {
  it('fits the long edge and keeps the aspect ratio', () => {
    expect(scaleToLongEdge(6000, 4000, 1800)).toEqual({ width: 1800, height: 1200, resized: true });
    expect(scaleToLongEdge(4000, 6000, 1800)).toEqual({ width: 1200, height: 1800, resized: true });
  });

  it('never enlarges a smaller original', () => {
    // Inventing pixels makes their work look worse, which is the one outcome
    // this feature exists to avoid.
    expect(scaleToLongEdge(900, 600, 1800)).toEqual({ width: 900, height: 600, resized: false });
    expect(scaleToLongEdge(1800, 1200, 1800).resized).toBe(false);
  });

  it('never produces a zero dimension on an extreme panorama', () => {
    // A very wide image's short edge can round to zero, and a zero-height
    // image is a crash rather than a small picture.
    const result = scaleToLongEdge(20000, 10, 1800);
    expect(result.height).toBeGreaterThanOrEqual(1);
    expect(result.width).toBe(1800);
  });

  it('returns nothing usable for nonsense input rather than NaN', () => {
    for (const [w, h] of [[0, 100], [100, 0], [-5, 5]]) {
      const result = scaleToLongEdge(w, h, 1800);
      expect(Number.isFinite(result.width)).toBe(true);
      expect(result.resized).toBe(false);
    }
  });
});

describe('watermarks', () => {
  it('is off unless switched on', () => {
    expect(watermarkFor({})).toBeNull();
    expect(watermarkFor({ watermarkEnabled: false, watermarkText: 'Studio' })).toBeNull();
  });

  it('uses the given text when there is some', () => {
    expect(watermarkFor({ watermarkEnabled: true, watermarkText: 'Studio Nine' })).toBe(
      'Studio Nine',
    );
  });

  it('falls back to the business name rather than rendering nothing', () => {
    // An enabled watermark that draws nothing looks like a bug to whoever
    // enabled it.
    expect(watermarkFor({ watermarkEnabled: true, businessName: 'Studio Nine' })).toBe(
      'Studio Nine',
    );
    expect(
      watermarkFor({ watermarkEnabled: true, watermarkText: '   ', businessName: 'Nine' }),
    ).toBe('Nine');
  });

  it('is null when switched on with nothing to draw', () => {
    expect(watermarkFor({ watermarkEnabled: true })).toBeNull();
    expect(watermarkFor({ watermarkEnabled: true, watermarkText: '  ', businessName: '' })).toBeNull();
  });

  it('bounds the length, since it is drawn across an image', () => {
    expect(watermarkFor({ watermarkEnabled: true, watermarkText: 'x'.repeat(500) })).toHaveLength(
      60,
    );
  });
});
