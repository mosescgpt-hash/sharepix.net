import { isWakeLockSupported, keepScreenAwake } from '../lib/wakeLock';

// Inject a fake wake-lock API rather than touching a global `navigator` — the
// Node test environment has no `navigator`, so mutating it isn't even possible.
function fakeApi() {
  const sentinel = { release: jest.fn().mockResolvedValue(undefined) };
  const request = jest.fn().mockResolvedValue(sentinel);
  return { api: { request }, request, sentinel };
}

describe('wake lock support detection', () => {
  it('returns a boolean and never throws, whatever the environment', () => {
    // In the Node test env there is no navigator, so this is false — the point
    // is that it degrades to a clean answer instead of a ReferenceError.
    expect(typeof isWakeLockSupported()).toBe('boolean');
  });
});

describe('keepScreenAwake', () => {
  it('returns a no-op controller when there is no API, and release never throws', async () => {
    const lock = await keepScreenAwake(null);
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it('requests a screen lock and releases it', async () => {
    const { api, request, sentinel } = fakeApi();
    const lock = await keepScreenAwake(api);
    expect(request).toHaveBeenCalledWith('screen');

    await lock.release();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('requests only one lock while held', async () => {
    const { api, request } = fakeApi();
    const lock = await keepScreenAwake(api);
    expect(request).toHaveBeenCalledTimes(1);
    await lock.release();
  });

  it('survives a denied request (e.g. low battery) without throwing', async () => {
    const request = jest.fn().mockRejectedValue(new Error('NotAllowedError'));
    const lock = await keepScreenAwake({ request });
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it('release is idempotent', async () => {
    const { api, sentinel } = fakeApi();
    const lock = await keepScreenAwake(api);
    await lock.release();
    await lock.release();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });
});
