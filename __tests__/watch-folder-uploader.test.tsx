import { act, render, screen, fireEvent } from '@testing-library/react';
import WatchFolderUploader from '@/components/WatchFolderUploader';
import { WATCH_INTERVAL_MS } from '@/lib/watchFolder';

/**
 * Drives the real scan loop against a fake folder. The File System Access API
 * does not exist in jsdom, so the picker and the handles are stand-ins with the
 * same shape; everything between them and `send` is the shipped code.
 */

interface FakeFile {
  name: string;
  size: number;
  lastModified: number;
}

function fakeFolder(files: FakeFile[]) {
  const dir = {
    kind: 'directory' as const,
    name: 'Tether',
    async *values() {
      for (const f of files) {
        yield {
          kind: 'file' as const,
          name: f.name,
          getFile: async () =>
            ({ name: f.name, size: f.size, lastModified: f.lastModified }) as unknown as File,
        };
      }
    },
  };
  return dir;
}

async function flush() {
  // Let the chain of awaited promises inside a scan run to completion.
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

async function nextScan() {
  await act(async () => {
    jest.advanceTimersByTime(WATCH_INTERVAL_MS);
    await flush();
  });
}

describe('WatchFolderUploader', () => {
  let files: FakeFile[];

  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    files = [{ name: 'old.jpg', size: 100, lastModified: 1 }];
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = jest.fn(
      async () => fakeFolder(files),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  async function start(send: jest.Mock, onSent = jest.fn()) {
    const view = render(<WatchFolderUploader eventId="e1" send={send} onSent={onSent} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose a folder' }));
      await flush();
    });
    return { onSent, unmount: view.unmount };
  }

  it('sends a new photo once it has settled, and not what was already there', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const { onSent } = await start(send);

    files.push({ name: 'IMG_0002.JPG', size: 500, lastModified: 5 });
    files.push({ name: 'IMG_0002.CR3', size: 900, lastModified: 5 });
    await nextScan(); // first sighting: still might be writing
    expect(send).not.toHaveBeenCalled();

    await nextScan(); // same size twice: settled
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].name).toBe('IMG_0002.JPG');
    expect(send.mock.calls[0][1]).toBe('image/jpeg');
    expect(onSent).toHaveBeenCalled();

    await nextScan();
    expect(send).toHaveBeenCalledTimes(1); // never twice
    expect(screen.getByRole('status').textContent).toContain('1 sent');
  });

  it('retries after a network failure, then sends', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue(undefined);
    await start(send);

    files.push({ name: 'a.jpg', size: 10, lastModified: 2 });
    await nextScan();
    await nextScan(); // fails
    await nextScan(); // retried
    expect(send).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toContain('1 sent');
  });

  it('stops watching when the server says the event is gone', async () => {
    const send = jest.fn().mockRejectedValue(new Error('That event could not be found.'));
    await start(send);

    files.push({ name: 'a.jpg', size: 10, lastModified: 2 });
    files.push({ name: 'b.jpg', size: 10, lastModified: 3 });
    await nextScan();
    await nextScan();
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Watching has stopped/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a folder again' })).toBeTruthy();
  });

  it('does not resend after the page is reloaded and the folder chosen again', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const first = await start(send);
    files.push({ name: 'a.jpg', size: 10, lastModified: 2 });
    await nextScan();
    await nextScan();
    expect(send).toHaveBeenCalledTimes(1);
    expect(first.onSent).toHaveBeenCalled();

    // A reload, then "also send what is already there". old.jpg was in the
    // folder at the first Start and so never sent — it must still be sendable.
    first.unmount();
    render(<WatchFolderUploader eventId="e1" send={send} onSent={jest.fn()} />);
    fireEvent.click(screen.getByLabelText('Also send photos already in it'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose a folder' }));
      await flush();
    });
    await nextScan();
    await nextScan();
    // old.jpg is sent now because it was asked for; a.jpg is remembered.
    expect(send.mock.calls.map((c) => c[0].name)).toEqual(['a.jpg', 'old.jpg']);
  });

  it('tells Safari and Firefox users where it works instead of showing a dead button', () => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    render(<WatchFolderUploader eventId="e1" send={jest.fn()} onSent={jest.fn()} />);
    expect(screen.getByText(/Chrome or Edge/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose a folder' })).toBeNull();
  });
});
