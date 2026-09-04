import {
  DEMO_STEPS,
  DEMO_STEP_COPY,
  MAX_DEMO_IMAGE_BYTES,
  checkDemoFile,
  nextStep,
  stepNumber,
  visitorPhotoVisible,
} from '../lib/demoFlow';

describe('the walkthrough order', () => {
  it('runs add → held → gallery → live', () => {
    // Moderation sits second on purpose: the photo has to be held before it
    // can be approved, and being made to wait is what teaches the feature.
    expect(DEMO_STEPS).toEqual(['add', 'held', 'gallery', 'live']);
  });

  it('walks forward one step at a time', () => {
    expect(nextStep('add')).toBe('held');
    expect(nextStep('held')).toBe('gallery');
    expect(nextStep('gallery')).toBe('live');
  });

  it('stops at the end rather than wrapping', () => {
    expect(nextStep('live')).toBeNull();
  });

  it('numbers steps from one', () => {
    expect(stepNumber('add')).toBe(1);
    expect(stepNumber('live')).toBe(DEMO_STEPS.length);
  });

  it('has copy for every step, and no orphan copy', () => {
    expect(Object.keys(DEMO_STEP_COPY).sort()).toEqual([...DEMO_STEPS].sort());
  });

  it('puts the visitor in the host seat exactly once', () => {
    // The switch is the point of the demo. Two host steps would blur it; none
    // would mean moderation is never actually shown.
    const hostSteps = DEMO_STEPS.filter((step) => DEMO_STEP_COPY[step].role === 'host');
    expect(hostSteps).toEqual(['held']);
  });
});

describe('what approving changes', () => {
  it('hides the photo until the host approves it', () => {
    // Same rule as the real gallery: held means guests do not see it.
    expect(visitorPhotoVisible(false)).toBe(false);
  });

  it('shows it once approved', () => {
    expect(visitorPhotoVisible(true)).toBe(true);
  });
});

describe('the file the visitor picks', () => {
  const image = { type: 'image/jpeg', size: 2_000_000, name: 'me.jpg' };

  it('accepts an ordinary photo', () => {
    expect(checkDemoFile(image)).toEqual({ ok: true });
  });

  it('turns away video with a reason, not a failure', () => {
    const result = checkDemoFile({ type: 'video/mp4', size: 5_000_000, name: 'clip.mp4' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/photo/i);
  });

  it('turns away anything that is not an image', () => {
    expect(checkDemoFile({ type: 'application/pdf', size: 1000, name: 'x.pdf' }).ok).toBe(false);
    expect(checkDemoFile({ type: '', size: 1000, name: 'x' }).ok).toBe(false);
  });

  it('refuses a file too large to hold in memory', () => {
    const result = checkDemoFile({ ...image, size: MAX_DEMO_IMAGE_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/large/i);
  });

  it('accepts one exactly at the ceiling', () => {
    expect(checkDemoFile({ ...image, size: MAX_DEMO_IMAGE_BYTES }).ok).toBe(true);
  });

  it('judges by MIME type, not by the filename', () => {
    // A demo that trusted the extension would show a broken image for a file
    // named .jpg that isn't one. Nothing is uploaded either way.
    expect(checkDemoFile({ type: 'text/plain', size: 100, name: 'sneaky.jpg' }).ok).toBe(false);
    expect(checkDemoFile({ type: 'image/png', size: 100, name: 'no-extension' }).ok).toBe(true);
  });
});
