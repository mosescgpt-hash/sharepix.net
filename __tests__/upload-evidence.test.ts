import { codeOnly, readSource } from './sourceGuards';

/**
 * Who uploaded a flagged photo: kept for investigation, flagged photos only,
 * and readable by admins alone.
 */

const schema = readSource('amplify/data/resource.ts');
const handler = codeOnly(readSource('amplify/functions/create-event-photo/handler.ts'));

function modelBlock(name: string): string {
  const start = schema.indexOf(`${name}: a`);
  expect(start).toBeGreaterThan(-1);
  const end = schema.indexOf(']),', schema.indexOf('.authorization(', start));
  return schema.slice(start, end + 3);
}

describe('the UploadEvidence model', () => {
  it('is readable by admins and nobody else', () => {
    const block = modelBlock('UploadEvidence');
    expect(block).toContain("allow.group('ADMINS')");
    for (const rule of ['allow.owner', 'ownerDefinedIn', 'allow.guest', 'allow.authenticated', 'allow.publicApiKey']) {
      expect(block).not.toContain(rule);
    }
  });

  it('is not on the Photo row, which hosts can read', () => {
    const photo = modelBlock('Photo');
    expect(photo).not.toContain('sourceIp');
  });
});

describe('the upload function', () => {
  it('records evidence only for a flagged photo', () => {
    const flaggedBranch = handler.slice(handler.indexOf("if (screening.status === 'flagged') {"));
    expect(flaggedBranch.indexOf('await recordUploadEvidence(')).toBeGreaterThan(-1);
    // Exactly one call site, and it is inside the flagged branch.
    expect(handler.split('await recordUploadEvidence(').length - 1).toBe(1);
    expect(handler.indexOf('await recordUploadEvidence(')).toBeGreaterThan(
      handler.indexOf("if (screening.status === 'flagged') {"),
    );
  });

  it('can write the table and not read it', () => {
    const backend = codeOnly(readSource('amplify/backend.ts'));
    expect(backend).toContain('uploadEvidenceTable.grantWriteData(createFn)');
    expect(backend).not.toContain('uploadEvidenceTable.grantReadWriteData(createFn)');
  });
});
