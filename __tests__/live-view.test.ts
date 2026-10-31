import {
  classifyLiveError,
  connectionMessage,
  emptyReelReason,
  fullscreenSupport,
  liveLinkPath,
  liveLinkUrl,
  mailtoLiveLink,
  toggleNativeFullscreen,
} from '../lib/liveView';
import { TimeoutError, isTimeoutError, withTimeout, withTimeoutOr } from '../lib/withTimeout';

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';

describe('live link', () => {
  it('is the live page, with the key in the fragment only when there is one', () => {
    expect(liveLinkPath('e1', '')).toBe('/event/e1/live');
    expect(liveLinkPath('e1', null)).toBe('/event/e1/live');
    expect(liveLinkPath('e1', KEY)).toBe(`/event/e1/live#k=${KEY}`);
    expect(liveLinkPath('e1', 'not-a-key')).toBe('/event/e1/live');
  });

  it('builds an absolute url without doubling slashes', () => {
    expect(liveLinkUrl('https://sharepix.net/', 'e1', KEY)).toBe(`https://sharepix.net/event/e1/live#k=${KEY}`);
  });

  it('builds a mailto that carries the link', () => {
    const href = mailtoLiveLink('Night of the Horse', 'https://sharepix.net/event/e1/live');
    expect(href.startsWith('mailto:?subject=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('https://sharepix.net/event/e1/live');
  });
});

describe('fullscreenSupport', () => {
  const el = (extra: Record<string, unknown> = {}) => ({ ...extra }) as unknown as HTMLElement;
  const doc = (extra: Record<string, unknown>, element: HTMLElement) =>
    ({ documentElement: element, ...extra }) as unknown as Document;

  it('uses the standard API when present', () => {
    const e = el({ requestFullscreen: jest.fn() });
    expect(fullscreenSupport(doc({ fullscreenEnabled: true }, e), e)).toBe('native');
  });
  it('falls back to the webkit API', () => {
    const e = el({ webkitRequestFullscreen: jest.fn() });
    expect(fullscreenSupport(doc({ fullscreenEnabled: false, webkitFullscreenEnabled: true }, e), e)).toBe('webkit');
  });
  it('reports none on iPhone Safari, which has no fullscreen for pages', () => {
    const e = el();
    expect(fullscreenSupport(doc({}, e), e)).toBe('none');
  });
  it('toggle resolves false (so the page can fill the screen instead) when there is none', async () => {
    const e = el();
    await expect(toggleNativeFullscreen(doc({}, e), e)).resolves.toBe(false);
  });
  it('toggle enters fullscreen when supported and resolves false when the browser refuses', async () => {
    const ok = el({ requestFullscreen: jest.fn().mockResolvedValue(undefined) });
    await expect(toggleNativeFullscreen(doc({ fullscreenEnabled: true, fullscreenElement: null }, ok), ok)).resolves.toBe(true);
    expect((ok as unknown as { requestFullscreen: jest.Mock }).requestFullscreen).toHaveBeenCalled();
    const refused = el({ requestFullscreen: jest.fn().mockRejectedValue(new Error('denied')) });
    await expect(
      toggleNativeFullscreen(doc({ fullscreenEnabled: true, fullscreenElement: null }, refused), refused),
    ).resolves.toBe(false);
  });
});

describe('why a screen is empty', () => {
  it('classifies the errors a phone can hit', () => {
    expect(classifyLiveError(new Error('SHARING_PAUSED'))).toBe('paused');
    expect(classifyLiveError(new Error('LINK_REQUIRED'))).toBe('replaced');
    expect(classifyLiveError(new Error('Timed out loading photos'))).toBe('timeout');
    expect(classifyLiveError(new Error('NotAuthorizedException: Unauthorized'))).toBe('session');
    expect(classifyLiveError(new Error('No credentials'))).toBe('session');
    expect(classifyLiveError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyLiveError(new Error('boom'))).toBe('other');
  });
  it('has a plain sentence for each', () => {
    for (const p of ['session', 'network', 'timeout', 'other'] as const) {
      expect(connectionMessage(p).length).toBeGreaterThan(20);
    }
  });
  it('tells "still in the buffer" and "only videos" apart from "no photos"', () => {
    expect(emptyReelReason(0, 0, 0)).toBe('none');
    expect(emptyReelReason(3, 2, 0)).toBe('none');
    expect(emptyReelReason(3, 0, 0)).toBe('buffer');
    expect(emptyReelReason(3, 0, 3)).toBe('videos-only');
    expect(emptyReelReason(3, 0, 1)).toBe('buffer');
  });
});

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes a result through', async () => {
    await expect(withTimeout(Promise.resolve(5), 1000)).resolves.toBe(5);
  });
  it('rejects with a TimeoutError when the promise never settles', async () => {
    const pending = withTimeout(new Promise<number>(() => undefined), 1000, 'slow');
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    jest.advanceTimersByTime(1000);
    await assertion;
    expect(isTimeoutError(new TimeoutError())).toBe(true);
    expect(isTimeoutError(new Error('x'))).toBe(false);
  });
  it('keeps the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('real')), 1000)).rejects.toThrow('real');
  });
  it('withTimeoutOr resolves to the fallback on a stall', async () => {
    const result = withTimeoutOr(new Promise<boolean>(() => undefined), 500, false);
    jest.advanceTimersByTime(500);
    await expect(result).resolves.toBe(false);
  });
});
