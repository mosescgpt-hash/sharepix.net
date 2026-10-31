import {
  eventIdFromPath,
  flushClientLog,
  getDeviceId,
  getSupportCode,
  isLoggingOff,
  logEvent,
  logRouteView,
  pendingForTests,
  resetClientLogForTests,
  setLogEvent,
  turnLoggingOff,
  turnLoggingOn,
} from '@/lib/clientLog';

const mockRecord = jest.fn();
let mockMode: 'identityPool' | 'userPool' = 'identityPool';
jest.mock('@/lib/dataClient', () => ({
  authModeFor: async () => mockMode,
  getClient: () => ({ mutations: { recordClientLog: (...args: unknown[]) => mockRecord(...args) } }),
}));
jest.mock('aws-amplify/auth', () => ({ fetchAuthSession: jest.fn(async () => ({ credentials: {} })) }));

const EVENT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

beforeEach(() => {
  window.localStorage.clear();
  resetClientLogForTests();
  mockRecord.mockReset();
  mockRecord.mockResolvedValue({ data: true });
  mockMode = 'identityPool';
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('what is recorded', () => {
  it('records a route as its path shape, never the fragment or query', () => {
    logRouteView(`/event/${EVENT}/upload?name=Sam#k=SECRETKEYSECRETKEYSECRETKEY`);
    const [entry] = pendingForTests();
    expect(entry.c).toBe('route_view');
    expect(entry.r).toBe('/event/:id/upload');
    expect(JSON.stringify(entry)).not.toMatch(/SECRET|Sam/);
  });

  it('files entries under the event in the current route, and under none elsewhere', () => {
    logRouteView(`/event/${EVENT}/live#k=abc`);
    logEvent('live_start');
    logRouteView('/my-events');
    logEvent('myevents_timeout');
    const entries = pendingForTests();
    expect(entries.find((e) => e.c === 'live_start')?.e).toBe(EVENT);
    expect(entries.find((e) => e.c === 'myevents_timeout')?.e).toBe('');
  });

  it('cleans free text, so an error message cannot carry a URL or key', () => {
    logEvent('upload_fail', 'PUT https://bucket.s3.amazonaws.com/x.jpg?X-Amz-Signature=abc failed');
    expect(pendingForTests()[0].d).toBe('PUT [url] failed');
  });

  it('stops repeating the same thing after a few times', () => {
    for (let i = 0; i < 50; i += 1) logEvent('live_poll_fail', 'timeout');
    expect(pendingForTests().length).toBeLessThanOrEqual(8);
  });

  it('never throws', () => {
    expect(() => logEvent('client_error', undefined as unknown as string)).not.toThrow();
  });
});

describe('event ids in paths', () => {
  it('finds the event in event, booth and b routes only', () => {
    expect(eventIdFromPath(`/event/${EVENT}/live`)).toBe(EVENT);
    expect(eventIdFromPath(`/booth/${EVENT}`)).toBe(EVENT);
    expect(eventIdFromPath('/privacy')).toBe('');
  });
});

describe('opting out', () => {
  it('records nothing once turned off, and forgets what was waiting', () => {
    logEvent('route_view');
    expect(pendingForTests()).toHaveLength(1);
    turnLoggingOff();
    expect(isLoggingOff()).toBe(true);
    expect(pendingForTests()).toHaveLength(0);
    logEvent('route_view');
    expect(pendingForTests()).toHaveLength(0);
    expect(window.localStorage.getItem('spx_did')).toBeNull();
    expect(getSupportCode()).toBeNull();
  });

  it('can be turned back on', () => {
    turnLoggingOff();
    turnLoggingOn();
    expect(isLoggingOff()).toBe(false);
    logEvent('route_view');
    expect(pendingForTests()).toHaveLength(1);
  });

  it('honours Do Not Track without being asked', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    try {
      logEvent('route_view');
      expect(isLoggingOff()).toBe(true);
      expect(pendingForTests()).toHaveLength(0);
    } finally {
      Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
    }
  });
});

describe('device id', () => {
  it('is random, stable on the device, and the support code is its first eight characters', () => {
    const id = getDeviceId();
    expect(id).toMatch(/^[A-HJKMNP-TV-Z2-9]{20}$/);
    expect(getDeviceId()).toBe(id);
    expect(getSupportCode()).toBe(`${id!.slice(0, 4)}-${id!.slice(4, 8)}`);
  });
});

describe('sending', () => {
  it('sends one batch per event with the guest credentials and clears what was sent', async () => {
    logRouteView(`/event/${EVENT}/upload`);
    logEvent('upload_start', 'image/jpeg', 120);
    await flushClientLog();
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const [args, options] = mockRecord.mock.calls[0];
    expect(args.eventId).toBe(EVENT);
    expect(options).toEqual({ authMode: 'identityPool' });
    const batch = JSON.parse(args.batchJson);
    expect(batch.entries.map((e: { c: string }) => e.c)).toEqual(['route_view', 'upload_start']);
    expect(JSON.stringify(batch)).not.toMatch(/photo\.jpg|@/);
    expect(pendingForTests()).toHaveLength(0);
  });

  it('holds account-level entries back from a guest, and sends them once signed in', async () => {
    logRouteView('/my-events');
    await flushClientLog();
    expect(mockRecord).not.toHaveBeenCalled();
    expect(pendingForTests()).toHaveLength(1);
    mockMode = 'userPool';
    await flushClientLog();
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][0].eventId).toBeUndefined();
  });

  it('keeps entries when a send fails, and saves them for the next visit', async () => {
    mockRecord.mockRejectedValue(new Error('network'));
    setLogEvent(EVENT);
    logEvent('upload_fail', 'network');
    await flushClientLog();
    expect(pendingForTests()).toHaveLength(1);
    const saved = JSON.parse(window.localStorage.getItem('spx_logq') ?? '[]');
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toMatch(/https?:/);
  });

  it('does not send while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    logRouteView(`/event/${EVENT}/live`);
    await flushClientLog();
    expect(mockRecord).not.toHaveBeenCalled();
    expect(pendingForTests()).toHaveLength(1);
  });

  it('treats a refused send as a failure to retry, not a success', async () => {
    mockRecord.mockResolvedValue({ errors: [{ message: 'denied' }] });
    logRouteView(`/event/${EVENT}/live`);
    await flushClientLog();
    expect(pendingForTests()).toHaveLength(1);
  });
});
