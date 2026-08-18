import {
  isHostOrAdmin,
  isVideoKey,
  isVisibleTo,
} from '../amplify/functions/list-event-photos/visibility';

const HOST = 'sub-abc';
const host = { sub: HOST, groups: [] };
const guest = { sub: undefined, groups: [] };
const otherHost = { sub: 'sub-xyz', groups: [] };
const admin = { sub: 'sub-admin', groups: ['ADMINS'] };
const owner = `${HOST}::host@example.com`;

describe('video key detection', () => {
  it('matches the extensions the video allowance counts', () => {
    for (const ext of ['mp4', 'MOV', 'webm', 'm4v', '3gp']) {
      expect(isVideoKey(`events/e1/photos/clip.${ext}`)).toBe(true);
    }
  });

  it('does not treat stills as video', () => {
    for (const key of ['a.jpg', 'a.heic', 'a.png', 'movie.jpg', 'a.mp4.jpg']) {
      expect(isVideoKey(`events/e1/photos/${key}`)).toBe(false);
    }
  });

  it('handles a missing key', () => {
    expect(isVideoKey(undefined)).toBe(false);
  });
});

describe('host identification', () => {
  it('matches the host by the sub inside the owner string', () => {
    expect(isHostOrAdmin(host, owner)).toBe(true);
  });

  it('rejects a different signed-in user', () => {
    expect(isHostOrAdmin(otherHost, owner)).toBe(false);
  });

  it('rejects an anonymous guest', () => {
    expect(isHostOrAdmin(guest, owner)).toBe(false);
    expect(isHostOrAdmin(null, owner)).toBe(false);
  });

  it('never lets an ownerless record match a caller with no sub', () => {
    // '' .split('::')[0] is '', and an anonymous guest's sub is undefined —
    // comparing them loosely would make every guest the host of every
    // ownerless photo.
    expect(isHostOrAdmin(guest, '')).toBe(false);
    expect(isHostOrAdmin(guest, undefined)).toBe(false);
    expect(isHostOrAdmin({ sub: '' }, '')).toBe(false);
  });

  it('lets a global admin through regardless of owner', () => {
    expect(isHostOrAdmin(admin, owner)).toBe(true);
    expect(isHostOrAdmin(admin, '')).toBe(true);
  });
});

describe('video visibility', () => {
  const video = { s3Key: 'events/e1/photos/clip.mov', eventOwner: owner };
  const photo = { s3Key: 'events/e1/photos/shot.jpg', eventOwner: owner };

  it('shows stills to everyone, including anonymous guests', () => {
    expect(isVisibleTo(photo, guest)).toBe(true);
    expect(isVisibleTo(photo, null)).toBe(true);
  });

  it('shows videos to the host and to admins', () => {
    expect(isVisibleTo(video, host)).toBe(true);
    expect(isVisibleTo(video, admin)).toBe(true);
  });

  it('withholds videos from guests and from other hosts', () => {
    // This is the cost control: a video is streamed from S3 at full size on
    // every play, so guest playback is the one upload with no ceiling on it.
    expect(isVisibleTo(video, guest)).toBe(false);
    expect(isVisibleTo(video, otherHost)).toBe(false);
    expect(isVisibleTo(video, null)).toBe(false);
  });

  it('withholds a video whose record has lost its owner', () => {
    // Failing open here would make every orphaned video public.
    expect(isVisibleTo({ s3Key: 'events/e1/photos/clip.mp4' }, guest)).toBe(false);
    expect(isVisibleTo({ s3Key: 'events/e1/photos/clip.mp4', eventOwner: '' }, host)).toBe(false);
  });
});
