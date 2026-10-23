import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PHOTO_ALERT_STEP,
  alertEmail,
  alertPhone,
  photoAlertMessage,
  photoAlertStepCrossed,
} from '../amplify/functions/create-event-photo/photoAlert';

describe('photo milestone alert', () => {
  it('fires at 5,000 and every further 5,000, once per step', () => {
    expect(PHOTO_ALERT_STEP).toBe(5_000);
    expect(photoAlertStepCrossed(4_998, 4_999)).toBe(0);
    expect(photoAlertStepCrossed(4_999, 5_000)).toBe(1);
    expect(photoAlertStepCrossed(5_000, 5_001)).toBe(0);
    expect(photoAlertStepCrossed(9_999, 10_000)).toBe(2);
    expect(photoAlertStepCrossed(14_999, 15_000)).toBe(3);
    expect(photoAlertStepCrossed(10_000, 9_999)).toBe(0); // a delete never alerts
  });

  it('reads recipients from configuration only', () => {
    expect(alertPhone({})).toBeNull();
    expect(alertPhone({ ADMIN_ALERT_PHONE: 'not a number' })).toBeNull();
    expect(alertPhone({ ADMIN_ALERT_PHONE: '+1 (555) 010-0000' })).toBe('+15550100000');
    expect(alertEmail({})).toBeNull();
    expect(alertEmail({}, 'ops@example.com')).toBe('ops@example.com');
    expect(alertEmail({ ADMIN_ALERT_EMAIL: 'a@example.com' }, 'ops@example.com')).toBe(
      'a@example.com',
    );
  });

  it('says nothing was paused, and keeps the text short', () => {
    const m = photoAlertMessage({
      eventId: 'e1',
      eventName: 'Line\nbreak',
      photoCount: 10_000,
      contributorCount: 42,
      appUrl: 'https://www.sharepix.net',
    });
    expect(m.subject).not.toMatch(/\n/);
    expect(m.subject).toContain('10,000');
    expect(m.text).toMatch(/Nothing was paused/);
    expect(m.sms.length).toBeLessThanOrEqual(160);
  });

  it('is wired into the upload handler with a once-per-step claim, and SNS is granted', () => {
    const root = join(__dirname, '..');
    const handler = readFileSync(join(root, 'amplify/functions/create-event-photo/handler.ts'), 'utf8');
    expect(handler).toContain('sendPhotoMilestoneAlert(');
    expect(handler).toContain('photoAlertStep < :step');
    const backend = readFileSync(join(root, 'amplify/backend.ts'), 'utf8');
    expect(backend).toContain("'sns:Publish'");
    expect(backend).toContain('ADMIN_ALERT_PHONE');
    expect(backend).toContain('ADMIN_ALERT_EMAIL');
  });
});
