/**
 * Operator alert when an event's photo count crosses each 5,000 step.
 *
 * Photos are unlimited, so nothing blocks at 5,000 any more. Instead the
 * operator hears about it — by email (SES) and text (SNS) — once at 5,000,
 * once at 10,000, and so on. "Once" is enforced at the table: the step is
 * claimed with a conditional write on `photoAlertStep`, so a burst of uploads
 * crossing the same line together sends one alert, not one per upload.
 *
 * Recipients come from configuration only, never from code:
 *   ADMIN_ALERT_EMAIL  — email recipient (falls back to the operator report
 *                        address the content-review alert already uses)
 *   ADMIN_ALERT_PHONE  — E.164 mobile number for the SMS (e.g. +15551234567);
 *                        unset means no text is sent
 *   ALERT_FROM_ADDRESS — the verified SES sender, shared with the other alerts
 *
 * Kept free of AWS clients so it can be unit tested; the handler passes them in.
 */

export const PHOTO_ALERT_STEP = 5_000;

/** The highest step (1 = 5,000, 2 = 10,000 …) crossed going from before to after, or 0. */
export function photoAlertStepCrossed(
  before: number,
  after: number,
  step: number = PHOTO_ALERT_STEP,
): number {
  if (!(step > 0) || !(after > before)) return 0;
  const was = Math.floor(Math.max(0, before) / step);
  const now = Math.floor(Math.max(0, after) / step);
  return now > was ? now : 0;
}

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function alertPhone(env: Record<string, string | undefined>): string | null {
  const raw = (env.ADMIN_ALERT_PHONE ?? '').replace(/[\s()-]/g, '');
  return E164.test(raw) ? raw : null;
}

export function alertEmail(
  env: Record<string, string | undefined>,
  fallback = '',
): string | null {
  const raw = (env.ADMIN_ALERT_EMAIL ?? '').trim() || fallback.trim();
  return EMAIL.test(raw) ? raw : null;
}

export function photoAlertMessage(input: {
  eventId: string;
  eventName: string;
  photoCount: number;
  contributorCount: number;
  appUrl: string;
}): { subject: string; text: string; sms: string } {
  const count = input.photoCount.toLocaleString('en-US');
  const name = (input.eventName || '(unnamed)').replace(/[\r\n]+/g, ' ').slice(0, 80);
  const subject = `SharePix: "${name}" passed ${count} photos`;
  const text = [
    `An event just passed ${count} photos. Nothing was paused — photos are unlimited. This is a heads-up so you can take a look.`,
    '',
    `Event: ${name}`,
    `Event id: ${input.eventId}`,
    `Photos: ${count}`,
    `Contributors: ${input.contributorCount.toLocaleString('en-US')}`,
    '',
    `Review it (sign in first): ${input.appUrl}/global-admin`,
    '',
    `You'll get this again at every further ${PHOTO_ALERT_STEP.toLocaleString('en-US')} photos.`,
  ].join('\n');
  const sms = `SharePix: "${name.slice(0, 40)}" passed ${count} photos (${input.contributorCount} contributors). Not paused. ${input.appUrl}/global-admin`;
  return { subject, text, sms };
}
