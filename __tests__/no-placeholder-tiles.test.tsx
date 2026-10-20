/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Artwork from '@/components/Artwork';
import { IMAGE_SLOTS, artworkFor, missingPhotography } from '@/lib/imagery';

/**
 * No page shows a blank tinted square where a photo should be. Two layers: a
 * slot without a photo renders nothing at all, and every slot the site's
 * source actually names has a photo, so nothing even collapses unexpectedly.
 */
describe('placeholder tiles', () => {
  it('render nothing when a slot has no photo', () => {
    const empty = missingPhotography()[0];
    if (!empty) return; // every slot filled: nothing to render empty
    const { container } = render(<Artwork slot={empty} caption="A caption" />);
    expect(container.innerHTML).toBe('');
  });

  it('every slot named in pages, components or lib has a photo', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    for (const dir of ['pages', 'components', 'lib']) walk(join(__dirname, '..', dir));

    const used = new Set<string>();
    for (const file of files) {
      if (file.endsWith('imagery.ts') || file.endsWith('siteImages.generated.ts')) continue;
      const src = readFileSync(file, 'utf8');
      for (const slot of IMAGE_SLOTS) {
        // Only image references: `slot: '…'`, `slot="…"`, `image: '…'`. A bare
        // string match would also catch, say, a help article slugged the same.
        const ref = new RegExp(`\\b(slot|image)\\s*[:=]\\s*\\{?\\s*['"]${slot}['"]`);
        if (ref.test(src)) used.add(slot);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const slot of used) {
      expect({ slot, photo: artworkFor(slot as never).kind }).toEqual({ slot, photo: 'photo' });
    }
  });
});
