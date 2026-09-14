import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly } from './sourceGuards';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('the gallery tells a guest what they are looking at', () => {
  const card = codeOnly(read('components', 'PhotoCard.tsx'));

  it('badges a professional photo', () => {
    expect(card).toContain('PROFESSIONAL_BADGE');
    expect(card).toContain('isProfessional(photo.sourceType)');
  });

  it('credits the photographer from the row, not from a profile lookup', () => {
    // Copied onto the row at upload, so a photographer renaming their business
    // later does not rewrite the credit on events that already happened.
    expect(card).toContain('photo.photographerName');
  });

  it('renders only links the photographer configured, through the safe filter', () => {
    expect(card).toContain('galleryLinksFor(');
    // Profile fields rendered as anchors. Anything not http(s) is dropped.
    expect(card).toContain('rel="noopener noreferrer nofollow"');
  });

  it('shows the uploader name for a guest photo, as it always did', () => {
    expect(card).toContain("Uploaded by: {photo.uploadedBy || 'Anonymous'}");
  });
});

describe('downloads are decided per photo, not per gallery', () => {
  const grid = codeOnly(read('components', 'PhotoGrid.tsx'));

  it('runs every tile through the shared rule', () => {
    // The same function the signing path uses, so the button and the endpoint
    // cannot disagree about one photo.
    expect(grid).toContain('canDownload={canDownload && proCanDownload(photo)}');
  });

  it('also stops a professional photo being selected for a bulk download', () => {
    // Hiding one button while leaving it selectable for the ZIP would be the
    // frontend-only restriction the brief rules out.
    expect(grid).toContain('selectable={canDownload && proCanDownload(photo)}');
  });
});

describe('the photo type carries what the gallery needs', () => {
  const types = read('lib', 'types.ts');

  it('has the pro fields, so the queue and the badge can read them', () => {
    // Without these the review page filtered on a field TypeScript did not
    // know about, and the queue rendered empty however many photos existed.
    for (const field of [
      'sourceType',
      'publishStatus',
      'photographerName',
      'photographerWebsite',
      'purchaseUrl',
      'contactUrl',
    ]) {
      expect(types).toContain(`${field}?: string | null;`);
    }
  });
});

describe('the review page can exercise the whole path', () => {
  const page = codeOnly(read('pages', 'pro', 'events', '[eventId]', 'review.tsx'));

  it('does slot, put, process — the three steps the Bridge will make', () => {
    expect(page).toContain('requestProUploadSlot(eventId');
    expect(page).toContain("method: 'PUT'");
    expect(page).toContain('processProPhoto(eventId, slot.uploadId)');
  });

  it('uploads one at a time', () => {
    // Thirty parallel PUTs on venue wifi is thirty stalled connections and no
    // feedback. Sequential is slower and finishes.
    expect(page).toContain('for (const file of Array.from(files))');
  });

  it('processes as a separate call, so a failure there is retryable', () => {
    // By that point the original is safely uploaded; losing the processing
    // step must not lose the photograph.
    expect(page.indexOf("method: 'PUT'")).toBeLessThan(page.indexOf('processProPhoto('));
  });
});
