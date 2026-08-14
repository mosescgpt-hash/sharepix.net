import {
  evaluateModeration,
  MODERATION_CONFIDENCE_THRESHOLD,
  type ModerationLabel,
} from '../amplify/functions/create-event-photo/moderation';

const label = (
  Name: string,
  Confidence = 99,
  ParentName = '',
): ModerationLabel => ({ Name, Confidence, ParentName });

describe('what gets flagged', () => {
  it('flags explicit nudity and sexual activity at high confidence', () => {
    expect(evaluateModeration([label('Explicit Nudity')]).flagged).toBe(true);
    expect(evaluateModeration([label('Sexual Activity')]).flagged).toBe(true);
    expect(evaluateModeration([label('Graphic Nudity')]).flagged).toBe(true);
  });

  it('flags a child label whose parent is a blocked category', () => {
    expect(
      evaluateModeration([label('Exposed Female Nipple', 97, 'Explicit Nudity')]).flagged,
    ).toBe(true);
  });

  it('reports what was detected, de-duplicated', () => {
    const result = evaluateModeration([
      label('Explicit Nudity'),
      label('Explicit Nudity'),
      label('Sexual Activity'),
    ]);
    expect(result.reasons).toEqual(['Explicit Nudity', 'Sexual Activity']);
  });

  it('passes a clean photo', () => {
    expect(evaluateModeration([]).flagged).toBe(false);
    expect(evaluateModeration(undefined).flagged).toBe(false);
  });
});

describe('wedding false positives stay unflagged', () => {
  // These are the categories that would otherwise fire all night at a reception
  // and train the host to ignore the alerts.
  it('allows alcohol and smoking, per the agreed policy', () => {
    expect(evaluateModeration([label('Alcohol')]).flagged).toBe(false);
    expect(evaluateModeration([label('Alcohol Use', 99, 'Alcohol')]).flagged).toBe(false);
    expect(evaluateModeration([label('Drinking', 99, 'Alcohol')]).flagged).toBe(false);
    expect(evaluateModeration([label('Smoking', 99, 'Drugs & Tobacco')]).flagged).toBe(false);
    expect(evaluateModeration([label('Tobacco')]).flagged).toBe(false);
  });

  it('allows kissing and non-explicit nudity — the couple kissing is the point', () => {
    expect(evaluateModeration([label('Kissing')]).flagged).toBe(false);
    expect(
      evaluateModeration([
        label('Kissing', 99, 'Non-Explicit Nudity of Intimate parts and Kissing'),
      ]).flagged,
    ).toBe(false);
  });

  it('allows swimwear, revealing clothes, and suggestive shots', () => {
    expect(evaluateModeration([label('Female Swimwear Or Underwear')]).flagged).toBe(false);
    expect(evaluateModeration([label('Revealing Clothes', 99, 'Suggestive')]).flagged).toBe(
      false,
    );
    expect(evaluateModeration([label('Suggestive')]).flagged).toBe(false);
  });

  it('keeps allowing an allowed label even when it also matches a blocked word', () => {
    // "Non-Explicit Nudity" contains "nudity"; the allow list must win.
    expect(evaluateModeration([label('Non-Explicit Nudity')]).flagged).toBe(false);
  });
});

describe('confidence threshold', () => {
  it('ignores low-confidence guesses', () => {
    expect(evaluateModeration([label('Explicit Nudity', 60)]).flagged).toBe(false);
    expect(
      evaluateModeration([label('Explicit Nudity', MODERATION_CONFIDENCE_THRESHOLD)]).flagged,
    ).toBe(true);
  });

  it('honors a custom threshold', () => {
    expect(evaluateModeration([label('Explicit Nudity', 70)], 60).flagged).toBe(true);
    expect(evaluateModeration([label('Explicit Nudity', 70)], 95).flagged).toBe(false);
  });

  it('treats a missing confidence as not meeting the bar', () => {
    expect(evaluateModeration([{ Name: 'Explicit Nudity' }]).flagged).toBe(false);
  });
});
