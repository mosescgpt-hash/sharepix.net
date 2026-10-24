/**
 * The booth delivery text (docs/booth-mode.md, "Texting"). Pure. Short — one
 * SMS segment where the event name allows — with the link, who it is from,
 * and how to stop. No name, no photo count: a text can be read by anyone
 * holding the phone.
 */
import { headerSafe } from './message';

export type SmsKind = 'ready' | 'reminder';

export function buildBoothSms(input: { kind: SmsKind; eventName: string; galleryUrl: string }): string {
  const event = headerSafe(input.eventName, 40) || 'the event';
  const lead =
    input.kind === 'ready'
      ? `SharePix: your photos from ${event} are ready.`
      : `SharePix: your photos from ${event} will be removed soon. Download them here.`;
  return `${lead} ${input.galleryUrl} Reply STOP to opt out.`;
}
