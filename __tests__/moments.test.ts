import {
  MAX_MOMENT_DESCRIPTION_LENGTH,
  MAX_MOMENT_NAME_LENGTH,
  cleanMomentText,
  groupPhotosByMoment,
  momentPhotoCounts,
  momentUploadPath,
  nextSortOrder,
  resolveMomentId,
  sortMoments,
  stripControlCharacters,
  validateMoment,
} from '../lib/moments';

describe('stripControlCharacters', () => {
  it('drops C0 control characters', () => {
    expect(stripControlCharacters(`Cere${String.fromCharCode(1)}mony`)).toBe('Ceremony');
  });

  it('drops DEL and the C1 range', () => {
    expect(stripControlCharacters(`a${String.fromCharCode(127)}b`)).toBe('ab');
    expect(stripControlCharacters(`a${String.fromCharCode(155)}b`)).toBe('ab');
  });

  // The bug this guards against was caught in the guest book: stripping tab and
  // newline as "invisible" welds the words on either side together.
  it('keeps tab and newline so words are not welded together', () => {
    expect(stripControlCharacters('First\nSecond')).toBe('First\nSecond');
    expect(stripControlCharacters('First\tSecond')).toBe('First\tSecond');
  });

  it('leaves ordinary text alone, including non-Latin scripts and emoji', () => {
    expect(stripControlCharacters('Café — 婚礼 🎉')).toBe('Café — 婚礼 🎉');
  });
});

describe('cleanMomentText', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanMomentText('  The   Ceremony \n ', 60)).toBe('The Ceremony');
  });

  it('caps the length', () => {
    expect(cleanMomentText('x'.repeat(200), 60)).toHaveLength(60);
  });

  it('returns empty for anything that is not a string', () => {
    expect(cleanMomentText(null, 60)).toBe('');
    expect(cleanMomentText(42, 60)).toBe('');
    expect(cleanMomentText(undefined, 60)).toBe('');
  });
});

describe('validateMoment', () => {
  it('accepts a named moment', () => {
    const result = validateMoment({ name: 'Ceremony', description: 'Before the meal' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.moment.name).toBe('Ceremony');
      expect(result.moment.description).toBe('Before the meal');
    }
  });

  it('rejects a moment with no name', () => {
    expect(validateMoment({ name: '   ' }).ok).toBe(false);
    expect(validateMoment({}).ok).toBe(false);
  });

  // A name made only of control characters is empty once cleaned, and must be
  // rejected rather than stored as a blank label nobody can click.
  it('rejects a name that is empty once cleaned', () => {
    expect(validateMoment({ name: String.fromCharCode(1, 2, 3) }).ok).toBe(false);
  });

  it('caps name and description at their limits', () => {
    const result = validateMoment({ name: 'n'.repeat(500), description: 'd'.repeat(900) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.moment.name).toHaveLength(MAX_MOMENT_NAME_LENGTH);
      expect(result.moment.description).toHaveLength(MAX_MOMENT_DESCRIPTION_LENGTH);
    }
  });

  it('stores an absent description as null rather than an empty string', () => {
    const result = validateMoment({ name: 'Ceremony', description: '  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.moment.description).toBeNull();
  });

  it('clamps a nonsense sort order instead of failing on it', () => {
    for (const [input, expected] of [
      [-5, 0],
      [99999, 9999],
      [3.6, 4],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
    ] as Array<[number, number]>) {
      const result = validateMoment({ name: 'Ceremony', sortOrder: input });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.moment.sortOrder).toBe(expected);
    }
  });
});

describe('sortMoments', () => {
  it('orders by sortOrder, then oldest first', () => {
    const moments = [
      { id: 'c', name: 'C', sortOrder: 1, createdAt: '2026-01-02T00:00:00Z' },
      { id: 'a', name: 'A', sortOrder: 0, createdAt: '2026-01-03T00:00:00Z' },
      { id: 'b', name: 'B', sortOrder: 1, createdAt: '2026-01-01T00:00:00Z' },
    ];
    expect(sortMoments(moments).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate its input', () => {
    const moments = [
      { id: 'b', name: 'B', sortOrder: 1 },
      { id: 'a', name: 'A', sortOrder: 0 },
    ];
    sortMoments(moments);
    expect(moments.map((m) => m.id)).toEqual(['b', 'a']);
  });

  // Without a final tie-break, two moments with the same order and no
  // timestamps can swap places between renders.
  it('is stable when order and timestamps are identical', () => {
    const moments = [
      { id: 'b', name: 'B' },
      { id: 'a', name: 'A' },
    ];
    expect(sortMoments(moments).map((m) => m.id)).toEqual(['a', 'b']);
    expect(sortMoments(sortMoments(moments)).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('treats a missing sortOrder as zero', () => {
    const moments = [
      { id: 'b', name: 'B', sortOrder: 2 },
      { id: 'a', name: 'A' },
    ];
    expect(sortMoments(moments).map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('nextSortOrder', () => {
  it('starts at zero for an empty event', () => {
    expect(nextSortOrder([])).toBe(0);
  });

  it('lands after the highest existing order', () => {
    expect(nextSortOrder([{ id: 'a', name: 'A', sortOrder: 4 }])).toBe(5);
  });

  it('does not run past the clamp validateMoment applies', () => {
    expect(nextSortOrder([{ id: 'a', name: 'A', sortOrder: 9999 }])).toBe(9999);
  });
});

describe('resolveMomentId', () => {
  const moments = [
    { id: 'm1', name: 'Ceremony' },
    { id: 'm2', name: 'Reception' },
  ];

  it('accepts an id belonging to this event', () => {
    expect(resolveMomentId('m1', moments)).toBe('m1');
    expect(resolveMomentId('  m2  ', moments)).toBe('m2');
  });

  // The case that matters in the room: a printed QR code outlives the moment
  // it was printed for. The photo still uploads, it just has no moment.
  it('folds an unknown id back to no moment', () => {
    expect(resolveMomentId('deleted-moment', moments)).toBeNull();
    expect(resolveMomentId('someone-elses-event-moment', moments)).toBeNull();
  });

  it('treats empty and non-string input as no moment', () => {
    expect(resolveMomentId('', moments)).toBeNull();
    expect(resolveMomentId('   ', moments)).toBeNull();
    expect(resolveMomentId(null, moments)).toBeNull();
    expect(resolveMomentId(undefined, moments)).toBeNull();
  });
});

describe('groupPhotosByMoment', () => {
  const moments = [
    { id: 'm2', name: 'Reception', sortOrder: 1 },
    { id: 'm1', name: 'Ceremony', sortOrder: 0 },
  ];

  it('groups in the host order with unassigned last', () => {
    const photos = [
      { id: 'p1', momentId: 'm2' },
      { id: 'p2', momentId: 'm1' },
      { id: 'p3', momentId: null },
    ];
    const groups = groupPhotosByMoment(photos, moments);
    expect(groups.map((g) => g.moment?.id ?? null)).toEqual(['m1', 'm2', null]);
    expect(groups[0].photos.map((p) => p.id)).toEqual(['p2']);
    expect(groups[2].photos.map((p) => p.id)).toEqual(['p3']);
  });

  // The whole point of the additive design: a photo pointing at a moment the
  // host deleted must still appear somewhere.
  it('keeps photos whose moment no longer exists', () => {
    const groups = groupPhotosByMoment([{ id: 'p1', momentId: 'gone' }], moments);
    const unassigned = groups.find((g) => g.moment === null);
    expect(unassigned?.photos.map((p) => p.id)).toEqual(['p1']);
  });

  it('keeps a moment with no photos, so the gallery agrees with the printed cards', () => {
    const groups = groupPhotosByMoment([{ id: 'p1', momentId: 'm1' }], moments);
    expect(groups.map((g) => g.moment?.id ?? null)).toEqual(['m1', 'm2']);
    expect(groups[1].photos).toEqual([]);
  });

  it('omits the unassigned group when everything is filed', () => {
    const groups = groupPhotosByMoment([{ id: 'p1', momentId: 'm1' }], moments);
    expect(groups.some((g) => g.moment === null)).toBe(false);
  });

  it('loses no photo', () => {
    const photos = [
      { id: 'p1', momentId: 'm1' },
      { id: 'p2', momentId: 'gone' },
      { id: 'p3' },
      { id: 'p4', momentId: 'm2' },
    ];
    const total = groupPhotosByMoment(photos, moments).reduce(
      (sum, group) => sum + group.photos.length,
      0,
    );
    expect(total).toBe(photos.length);
  });

  it('returns everything unassigned when the event has no moments', () => {
    const groups = groupPhotosByMoment([{ id: 'p1' }, { id: 'p2' }], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].moment).toBeNull();
    expect(groups[0].photos).toHaveLength(2);
  });
});

describe('momentPhotoCounts', () => {
  it('counts only assigned photos', () => {
    const counts = momentPhotoCounts([
      { id: 'p1', momentId: 'm1' },
      { id: 'p2', momentId: 'm1' },
      { id: 'p3', momentId: 'm2' },
      { id: 'p4', momentId: null },
      { id: 'p5' },
    ]);
    expect(counts.get('m1')).toBe(2);
    expect(counts.get('m2')).toBe(1);
    expect(counts.size).toBe(2);
  });
});

describe('momentUploadPath', () => {
  it('is the plain upload page with no moment', () => {
    expect(momentUploadPath('ev1')).toBe('/event/ev1/upload');
    expect(momentUploadPath('ev1', null)).toBe('/event/ev1/upload');
  });

  it('preselects a moment', () => {
    expect(momentUploadPath('ev1', 'm1')).toBe('/event/ev1/upload?moment=m1');
  });

  it('encodes the moment id', () => {
    expect(momentUploadPath('ev1', 'a b&c')).toBe('/event/ev1/upload?moment=a%20b%26c');
  });
});
