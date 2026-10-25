import { mayRunOwnBooth } from '../lib/photographerAccess';
import { codeOnly, readSource } from './sourceGuards';

describe('mayRunOwnBooth', () => {
  const event = { owner: 'sub-1::host@example.com', boothMode: true };
  it('lets the host run their own booth event', () => {
    expect(mayRunOwnBooth(event, 'sub-1', [])).toBe(true);
  });
  it('lets an admin', () => {
    expect(mayRunOwnBooth(event, 'other', ['ADMINS'])).toBe(true);
  });
  it('refuses anyone else, a prefix match, and a non-booth event', () => {
    expect(mayRunOwnBooth(event, 'sub-2', [])).toBe(false);
    expect(mayRunOwnBooth(event, 'sub', [])).toBe(false);
    expect(mayRunOwnBooth({ ...event, boothMode: false }, 'sub-1', [])).toBe(false);
    expect(mayRunOwnBooth({ ...event, boothMode: false }, 'x', ['ADMINS'])).toBe(false);
    expect(mayRunOwnBooth(null, 'sub-1', [])).toBe(false);
    expect(mayRunOwnBooth({ owner: '', boothMode: true }, '', [])).toBe(false);
  });
});

describe('server paths for the host', () => {
  const scan = codeOnly(readSource('amplify/functions/booth-scan/handler.ts'));
  const decide = codeOnly(readSource('amplify/functions/decide-pro-photo/handler.ts'));
  const upload = codeOnly(readSource('amplify/functions/pro-upload/handler.ts'));
  const process = codeOnly(readSource('amplify/functions/process-pro-photo/handler.ts'));
  const backend = codeOnly(readSource('amplify/backend.ts'));

  it('booth-scan checks the host with mayRunOwnBooth', () => {
    expect(scan).toContain('mayRunOwnBooth');
    expect(scan).toContain('asHost');
  });
  it('booth-scan signs thumbnails only, never originals', () => {
    expect(scan).toContain("key.includes('/originals/')");
    expect(scan).toContain("key.startsWith('pro/')");
  });
  it('the host only approves booth photos, and never publishes them', () => {
    expect(decide).toContain('mayRunOwnBooth');
    expect(decide).toContain("if (boothPhoto && target === 'published')");
  });
  it('host uploads go through the same pipeline', () => {
    expect(upload).toContain('mayRunOwnBooth');
    expect(process).toContain('mayRunOwnBooth');
  });
  it('grants what the host paths need', () => {
    expect(backend).toContain('photoTable.grantReadWriteData(boothScanFn)');
    expect(backend).toContain("bucket.grantRead(boothScanFn, 'pro/*')");
    expect(backend).toContain('eventTable.grantReadData(decideProFn)');
  });
});

describe('the booth admin screen', () => {
  const host = readSource('components/BoothTab.tsx');
  const sort = readSource('components/BoothSort.tsx');
  it('shows booth photos to the host', () => {
    expect(host).toContain('<BoothSort');
    expect(sort).toContain('assignBoothPhotos');
    expect(host).toContain('requestProUploadSlot');
    expect(host).toContain("decideProPhoto(id, 'approve')");
  });
});
