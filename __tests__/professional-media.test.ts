import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PREVIEW_LONG_EDGE,
  DEFAULT_PUBLISHING_MODE,
  MAX_PREVIEW_LONG_EDGE,
  MIN_PREVIEW_LONG_EDGE,
  PUBLISHING_MODES,
  PUBLISH_STATUSES,
  canDownload,
  canTransition,
  defaultsFor,
  galleryLinksFor,
  guestVariantFor,
  isProfessionalKey,
  isProfessionalOriginalKey,
  mayServeToGuest,
  previewLongEdge,
  professionalKeys,
  shouldAutoPublishOnProcessed,
  shouldPublishOnApproval,
  type PublishStatus,
} from '../lib/professionalMedia';

describe('the defaults a professional upload starts with', () => {
  // Every one of these is unrecoverable in the wrong direction: an original
  // served once has been copied.
  it('is preview-only, un-downloadable, reduced, and unpublished', () => {
    const defaults = defaultsFor();
    expect(defaults.sourceType).toBe('professional');
    expect(defaults.downloadAllowed).toBe(false);
    expect(defaults.previewOnly).toBe(true);
    expect(defaults.reducedResolutionEnabled).toBe(true);
    expect(defaults.publishStatus).toBe('received');
  });

  it('never starts in a state a guest can see', () => {
    expect(mayServeToGuest(defaultsFor())).toBe(false);
  });

  it('starts before review, because there is nothing to review yet', () => {
    // A row claiming to await review with no preview yet would put an empty
    // tile in the photographer's queue.
    expect(defaultsFor().publishStatus).not.toBe('awaiting_review');
  });

  it('clamps preview resolution into the supported range', () => {
    expect(previewLongEdge(null)).toBe(DEFAULT_PREVIEW_LONG_EDGE);
    expect(previewLongEdge(undefined)).toBe(DEFAULT_PREVIEW_LONG_EDGE);
    expect(previewLongEdge(NaN)).toBe(DEFAULT_PREVIEW_LONG_EDGE);
    expect(previewLongEdge(50)).toBe(MIN_PREVIEW_LONG_EDGE);
    expect(previewLongEdge(99999)).toBe(MAX_PREVIEW_LONG_EDGE);
    expect(previewLongEdge(1600)).toBe(1600);
  });

  it('keeps the default inside its own range, and high enough to look good', () => {
    expect(DEFAULT_PREVIEW_LONG_EDGE).toBeGreaterThanOrEqual(MIN_PREVIEW_LONG_EDGE);
    expect(DEFAULT_PREVIEW_LONG_EDGE).toBeLessThanOrEqual(MAX_PREVIEW_LONG_EDGE);
  });
});

describe('what a guest may be served', () => {
  const pro = (publishStatus: PublishStatus) => ({
    sourceType: 'professional',
    publishStatus,
  });

  it('shows a professional photo only once published', () => {
    for (const status of PUBLISH_STATUSES) {
      expect(mayServeToGuest(pro(status))).toBe(status === 'published');
    }
  });

  it('never points a guest at a professional original', () => {
    for (const status of PUBLISH_STATUSES) {
      expect(guestVariantFor(pro(status))).toBe('preview');
    }
  });

  it('leaves guest media alone entirely', () => {
    // The event's own lifecycle rules still decide; this must not start
    // second-guessing them.
    expect(mayServeToGuest({ sourceType: 'guest', publishStatus: null })).toBe(true);
    expect(guestVariantFor({ sourceType: 'guest' })).toBe('original');
    expect(mayServeToGuest({})).toBe(true);
  });
});

describe('downloads', () => {
  it('refuses every professional photo, published or not', () => {
    for (const status of PUBLISH_STATUSES) {
      expect(canDownload({ sourceType: 'professional', publishStatus: status })).toBe(false);
    }
  });

  it('refuses even when the stored flag says otherwise', () => {
    // downloadAllowed is a stored boolean, and stored booleans get set by
    // migrations, admin tools and mistakes.
    expect(
      canDownload({
        sourceType: 'professional',
        publishStatus: 'published',
        downloadAllowed: true,
        previewOnly: false,
      }),
    ).toBe(false);
  });

  it('lets guest media follow its own flag', () => {
    expect(canDownload({ sourceType: 'guest', downloadAllowed: true })).toBe(true);
    expect(canDownload({ sourceType: 'guest', downloadAllowed: false })).toBe(false);
    // Absent means allowed, which is how every existing guest photo behaves.
    expect(canDownload({ sourceType: 'guest' })).toBe(true);
  });
});

describe('the status machine', () => {
  it('runs received to published through review', () => {
    expect(canTransition('received', 'processing')).toBe(true);
    expect(canTransition('processing', 'awaiting_review')).toBe(true);
    expect(canTransition('awaiting_review', 'approved')).toBe(true);
    expect(canTransition('approved', 'published')).toBe(true);
  });

  it('lets nothing out of rejected', () => {
    // Un-rejecting is a deliberate action with its own audit trail, not a
    // quiet status flip.
    for (const to of PUBLISH_STATUSES) {
      expect(canTransition('rejected', to)).toBe(false);
    }
  });

  it('can be rejected from any live stage', () => {
    for (const from of ['received', 'processing', 'awaiting_review', 'approved', 'published'] as const) {
      expect(canTransition(from, 'rejected')).toBe(true);
    }
  });

  it('can unpublish back to approved but not further', () => {
    expect(canTransition('published', 'approved')).toBe(true);
    expect(canTransition('published', 'received')).toBe(false);
    expect(canTransition('published', 'awaiting_review')).toBe(false);
  });

  it('never skips review on the way to published', () => {
    expect(canTransition('received', 'published')).toBe(false);
    expect(canTransition('processing', 'published')).toBe(false);
    expect(canTransition('awaiting_review', 'published')).toBe(false);
  });

  it('has no transition to itself', () => {
    for (const status of PUBLISH_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});

describe('publishing modes', () => {
  it('defaults to review, never to auto-publishing a photographer’s unseen work', () => {
    expect(DEFAULT_PUBLISHING_MODE).toBe('approve_first');
    expect(PUBLISHING_MODES).toContain('auto_live');
  });

  it('publishes on approval when live, in both review modes', () => {
    expect(shouldPublishOnApproval({ livePublishing: true, mode: 'approve_first' })).toBe(true);
    expect(shouldPublishOnApproval({ livePublishing: true, mode: 'auto_live' })).toBe(true);
  });

  it('waits for an explicit publish in selected_only', () => {
    expect(shouldPublishOnApproval({ livePublishing: true, mode: 'selected_only' })).toBe(false);
  });

  it('publishes nothing at all while paused', () => {
    // Approvals, processing and uploads all continue; the gallery does not
    // change until the photographer resumes.
    for (const mode of PUBLISHING_MODES) {
      expect(shouldPublishOnApproval({ livePublishing: false, mode })).toBe(false);
      expect(shouldAutoPublishOnProcessed({ livePublishing: false, mode })).toBe(false);
    }
  });

  it('skips human review only in auto_live', () => {
    for (const mode of PUBLISHING_MODES) {
      expect(shouldAutoPublishOnProcessed({ livePublishing: true, mode })).toBe(
        mode === 'auto_live',
      );
    }
  });
});

describe('where professional objects live', () => {
  const keys = professionalKeys('evt1', 'up1');

  it('keeps originals in their own prefix', () => {
    expect(keys.original).toBe('pro/evt1/originals/up1');
    expect(isProfessionalOriginalKey(keys.original)).toBe(true);
  });

  it('does not mistake a preview or thumbnail for an original', () => {
    expect(isProfessionalOriginalKey(keys.preview)).toBe(false);
    expect(isProfessionalOriginalKey(keys.thumbnail)).toBe(false);
  });

  it('does not mistake a guest photo for one', () => {
    expect(isProfessionalOriginalKey('events/evt1/photos/abc.jpg')).toBe(false);
    expect(isProfessionalOriginalKey('events/evt1/previews/abc.jpg')).toBe(false);
  });

  it('keeps every professional variant out of the guest-readable prefix', () => {
    // amplify/storage/resource.ts grants allow.guest.to(['read']) on
    // 'events/*', and Amplify Gen 2 storage paths take a wildcard only at the
    // end — there is no way to carve an exception back out. So anything under
    // events/ is readable by any guest holding the key, and none of these may
    // live there. A preview still in the review queue is as private as the
    // original; "the key is a UUID" is not an access rule.
    for (const key of Object.values(keys)) {
      expect(key.startsWith('events/')).toBe(false);
      expect(isProfessionalKey(key)).toBe(true);
    }
  });

  it('is not granted to anyone by the storage rules', () => {
    const rules = readFileSync(
      join(__dirname, '..', 'amplify', 'storage', 'resource.ts'),
      'utf8',
    );
    // The prefix appears in no access rule at all, which is what makes it
    // reachable only by a Lambda holding an explicit IAM grant.
    expect(rules).not.toMatch(/'pro\//);
  });

  it('gives the three variants three distinct keys', () => {
    expect(new Set(Object.values(keys)).size).toBe(3);
  });
});

describe('the photographer’s links', () => {
  it('puts buying first', () => {
    const links = galleryLinksFor({
      website: 'https://example.com',
      purchaseGalleryUrl: 'https://example.com/buy',
      contactUrl: 'https://example.com/hello',
    });
    expect(links.map((link) => link.label)).toEqual([
      'Purchase photo',
      'View photographer',
      'Contact photographer',
    ]);
  });

  it('shows nothing for a profile with no links', () => {
    expect(galleryLinksFor({})).toEqual([]);
    expect(galleryLinksFor({ website: '   ', contactUrl: null })).toEqual([]);
  });

  it('drops anything that is not an http(s) url', () => {
    // These fields are host-supplied text rendered as an anchor.
    const links = galleryLinksFor({
      website: 'javascript:alert(1)',
      purchaseGalleryUrl: 'data:text/html,<script>',
      contactUrl: 'not a url at all',
    });
    expect(links).toEqual([]);
  });

  it('keeps an ordinary http url', () => {
    expect(galleryLinksFor({ website: 'http://example.com' })).toHaveLength(1);
  });
});
