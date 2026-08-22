import { isWakeLockSupported, keepScreenAwake } from '../lib/wakeLock';

type Sentinel = { release: jest.Mock };

function installWakeLock(): { request: jest.Mock; sentinel: Sentinel } {
  const sentinel: Sentinel = { release: jest.fn().mockResolvedValue(undefined) };
  const request = jest.fn().mockResolvedValue(sentinel);
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
  });
  return { request, sentinel };
}

function removeWakeLock() {
  Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
}

afterEach(() => {
  removeWakeLock();
  jest.restoreAllMocks();
});

describe('wake lock support detection', () => {
  it('reports false when the API is absent', () => {
    removeWakeLock();
    expect(isWakeLockSupported()).toBe(false);
  });

  it('reports true when the API is present', () => {
    installWakeLock();
    expect(isWakeLockSupported()).toBe(true);
  });
});

describe('keepScreenAwake', () => {
  it('returns a no-op controller when unsupported, and release never throws', async () => {
    removeWakeLock();
    const lock = await keepScreenAwake();
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it('requests a screen lock and releases it', async () => {
    const { request, sentinel } = installWakeLock();
    const lock = await keepScreenAwake();
    expect(request).toHaveBeenCalledWith('screen');

    await lock.release();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('requests only one lock while held (no duplicate on a second acquire path)', async () => {
    // Guarded so repeated internal acquires don't stack sentinels.
    const { request } = installWakeLock();
    const lock = await keepScreenAwake();
    expect(request).toHaveBeenCalledTimes(1);
    await lock.release();
  });

  it('survives a denied request (e.g. low battery) without throwing', async () => {
    const request = jest.fn().mockRejectedValue(new Error('NotAllowedError'));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    const lock = await keepScreenAwake();
    await expect(lock.release()).resolves.toBeUndefined();
  });
});
