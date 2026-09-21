import { bodyOf, codeOnly, readSource } from './sourceGuards';

/**
 * The demo is the only place a stranger can put a file into SharePix without an
 * account, reached from a link on the front page. These guards are about that
 * surface rather than about the feature working.
 */

const COPIES = [
  'amplify/functions/sanitize-upload/demoUpload.ts',
  'amplify/functions/demo-cleanup/demoUpload.ts',
];

describe('the copies have not drifted', () => {
  it.each(COPIES)('%s matches lib/demoUpload.ts below the header', (copy) => {
    // The prefix and the TTL are the dangerous pair: one copy decides what the
    // sweep may delete, another decides what the page promises. A drift is
    // either a broken promise or an event's photos swept.
    expect(bodyOf(readSource(copy))).toBe(bodyOf(readSource('lib/demoUpload.ts')));
  });
});

describe('nothing can read a demo upload', () => {
  const storage = codeOnly(readSource('amplify/storage/resource.ts'));

  it('grants write and nothing else on the demo prefix', () => {
    // The whole safety model. Granting read here — to anyone, including
    // admins — turns an unauthenticated upload box on the front page into a
    // place a stranger's photo can be looked at.
    expect(storage).toContain("'demo/*': [allow.guest.to(['write']), allow.authenticated.to(['write'])]");
    expect(storage).not.toContain("allow.guest.to(['read', 'write'])\n    ],\n    'demo/*'");
  });

  it('gives the demo prefix no read to admins either', () => {
    const demoLine = storage.slice(storage.indexOf("'demo/*'"));
    const clause = demoLine.slice(0, demoLine.indexOf(']') + 1);
    expect(clause).not.toContain('read');
    expect(clause).not.toContain('ADMINS');
  });

  it('has no page that fetches from the demo prefix', () => {
    // A read path would have to exist somewhere for a stored demo photo to be
    // served. This is the check that it does not.
    const page = codeOnly(readSource('pages/demo/try-upload.tsx'));
    expect(page).not.toContain('getUrl');
    expect(page).not.toContain('downloadData');
    expect(page).toContain('URL.createObjectURL(file)');
  });
});

describe('the demo upload is vetted like a real one', () => {
  const handler = codeOnly(readSource('amplify/functions/sanitize-upload/handler.ts'));

  it('runs the same sniffing and stripping rather than skipping the prefix', () => {
    // "We delete it within the hour" is not a reason to host arbitrary bytes
    // from an anonymous stranger in the meantime.
    expect(handler).toContain('const demo = isDemoKey(key);');
    expect(handler).toContain('if (!demo && !ORIGINAL_KEY.test(key))');
  });

  it('refuses video in the demo', () => {
    // Video is not screened at all, so a public target accepting it would host
    // unreviewed footage from strangers.
    expect(handler).toContain("if (demo && kind !== 'image')");
    expect(handler).toContain('demo-video-not-allowed');
  });

  it('applies the lower demo size ceiling', () => {
    expect(handler).toContain('const ceiling = demo ? DEMO_MAX_BYTES : maxBytesForKind(kind);');
  });

  it('never mirrors a demo upload to the CDN', () => {
    // Nothing reads it, so a copy in R2 would be a stranger's photo in a
    // second store with no reader at all.
    expect(handler).toContain('if (demo) return;');
  });
});

describe('the sweep', () => {
  const handler = codeOnly(readSource('amplify/functions/demo-cleanup/handler.ts'));
  const resource = codeOnly(readSource('amplify/functions/demo-cleanup/resource.ts'));
  const backend = codeOnly(readSource('amplify/backend.ts'));

  it('runs far more often than the hour it enforces', () => {
    // A daily sweep would make "deleted within the hour" aspirational.
    expect(resource).toContain("schedule: 'every 15m'");
  });

  it('has no enable switch', () => {
    // reclaim-storage has one because it deletes a customer's photographs and
    // the safe default is not to. There is no state in which the right
    // behaviour is to keep a stranger's demo upload.
    expect(resource).not.toContain('ENABLED');
    expect(handler).not.toContain('STORAGE_RECLAIM_ENABLED');
  });

  it('lists only the demo prefix', () => {
    expect(handler).toContain('Prefix: DEMO_PREFIX');
  });

  it('checks the prefix again before deleting, whatever S3 returned', () => {
    // The one job that removes somebody's photograph without being asked to. A
    // listing bug must not be the only thing standing between it and a real
    // event's gallery.
    expect(handler).toContain('if (!isDemoKey(key))');
    expect(handler).toContain('DEMO CLEANUP REFUSED A KEY');
  });

  it('ages objects by S3 time rather than anything in the key', () => {
    // A key is written by the browser. LastModified is written by S3.
    expect(handler).toContain('object.LastModified');
  });

  it('holds a delete scoped to the demo prefix and not the bucket', () => {
    // grantDelete would hand it every photograph SharePix stores.
    expect(backend).toContain("actions: ['s3:DeleteObject']");
    expect(backend).toContain("bucket.arnForObjects('demo/*')");
    expect(backend).not.toContain('bucket.grantDelete(demoCleanupFn)');
  });

  it('says what it did on every run, including the quiet ones', () => {
    // This job existing and doing nothing looks exactly like this job not
    // running, and the difference is whether a promise is being kept.
    expect(handler).toContain("console.log('Demo cleanup'");
  });
});

describe('the page', () => {
  const page = codeOnly(readSource('pages/demo/try-upload.tsx'));

  it('uses the real PhotoGrid rather than an imitation of it', () => {
    // A hand-built copy would drift from the product and start
    // misrepresenting it — the same reasoning as the sample gallery page.
    expect(page).toContain('<PhotoGrid');
  });

  it('shows the photo before the upload finishes', () => {
    expect(page).toContain("state: 'uploading'");
  });

  it('keeps the photo on screen when the upload fails', () => {
    // It is their own file. Removing it would read as "your photo was
    // rejected", which is the opposite of the point.
    expect(page).toContain("state: 'failed'");
  });

  it('revokes its object URLs', () => {
    expect(page).toContain('URL.revokeObjectURL');
  });

  it('states the promise from the shared module, not a retyped sentence', () => {
    expect(page).toContain('{DEMO_PROMISE}');
  });
});

describe('the homepage code points at it', () => {
  const home = codeOnly(readSource('pages/index.tsx'));

  it('encodes the try-an-upload page in the QR', () => {
    expect(home).toContain('/demo/try-upload');
  });
});
