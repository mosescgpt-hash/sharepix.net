import {
  UPLOAD_WINDOW_CLOSED_MESSAGE,
  uploadWindowClosed,
} from '../amplify/functions/create-event-photo/uploadWindow';
import { UPLOAD_WINDOW_DAYS as LIB_WINDOW_DAYS } from '../lib/pricing';
import { UPLOAD_WINDOW_DAYS as LAMBDA_WINDOW_DAYS } from '../amplify/functions/create-event/newEvent';

const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('the upload window as a server-side gate', () => {
  it('accepts uploads before the window closes', () => {
    expect(uploadWindowClosed('2026-06-02T12:00:00.000Z', NOW)).toBe(false);
  });

  it('refuses them once it has', () => {
    expect(uploadWindowClosed('2026-05-31T12:00:00.000Z', NOW)).toBe(true);
  });

  it('treats the closing instant itself as closed', () => {
    // Uploading at exactly the boundary is a coin toss otherwise, and the host
    // was told a date. `>=` is the same comparison eventLifecycle uses.
    expect(uploadWindowClosed('2026-06-01T12:00:00.000Z', NOW)).toBe(true);
  });

  it('leaves uploads open when there is no window to read', () => {
    // Events predating the lifecycle model have no window. Refusing a real
    // guest at a real party over a missing field is the worse failure.
    for (const missing of [null, undefined, '']) {
      expect(uploadWindowClosed(missing, NOW)).toBe(false);
    }
  });

  it('leaves uploads open when the window cannot be parsed', () => {
    // A window that cannot be read is not a window that has closed. Garbage in
    // this field must not become a silent, permanent outage for one event.
    for (const junk of ['soon', '2026-13-45', 'null', '{}']) {
      expect(uploadWindowClosed(junk, NOW)).toBe(false);
    }
  });

  it('tells the guest nothing about how the window is reopened', () => {
    // The host extends it; the guest can only be told it is shut.
    expect(UPLOAD_WINDOW_CLOSED_MESSAGE).not.toMatch(/extend|pay|host|upgrade/i);
  });
});

describe('the window length', () => {
  it('is 60 days, and the Lambda agrees with lib/pricing.ts', () => {
    // Two hand-maintained copies, because Amplify functions cannot import from
    // lib/. The reprice that missed the create-event copy is exactly the drift
    // this asserts against.
    expect(LIB_WINDOW_DAYS).toBe(60);
    expect(LAMBDA_WINDOW_DAYS).toBe(LIB_WINDOW_DAYS);
  });

  it('closes a new event 60 days out', () => {
    const closesAt = new Date(NOW + LIB_WINDOW_DAYS * DAY).toISOString();
    expect(uploadWindowClosed(closesAt, NOW + 59 * DAY)).toBe(false);
    expect(uploadWindowClosed(closesAt, NOW + 61 * DAY)).toBe(true);
  });
});
