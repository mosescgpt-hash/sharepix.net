import { codeOnly, readSource } from './sourceGuards';

describe('deleting several photos at once on Manage', () => {
  const grid = codeOnly(readSource('components/AdminPhotoGrid.tsx'));

  it('keeps the delete selection separate from the download-QR selection', () => {
    expect(grid).toContain('const [toDelete, setToDelete]');
    expect(grid).toMatch(/const canSelect = selectable && !hidden && !held && !deleteMode;/);
  });

  it('asks once for the whole batch, then deletes each through the same call as one', () => {
    expect(grid).toMatch(/window\.confirm\(`Delete \$\{label\} permanently\?/);
    expect(grid).toContain('await deleteEventPhoto(photo);');
  });

  it('keeps anything that failed selected so it can be retried', () => {
    expect(grid).toContain('setToDelete(new Set(failed))');
  });
});
