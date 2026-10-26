import { App, Stack } from 'aws-cdk-lib';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Template } from 'aws-cdk-lib/assertions';
import { indexReadStatement } from '../amplify/lib/indexGrants';
import { codeOnly, readSource } from './sourceGuards';

describe('booth functions can query their indexes', () => {
  it('grants Query on <table>/index/* for each table', () => {
    const stack = new Stack(new App(), 'T');
    const role = new Role(stack, 'R', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') });
    role.addToPolicy(indexReadStatement(['arn:aws:dynamodb:us-east-1:1:table/BoothAttendee-x']));
    const json = JSON.stringify(Template.fromStack(stack).toJSON());
    expect(json).toContain('dynamodb:Query');
    expect(json).toContain('table/BoothAttendee-x/index/*');
  });

  it('backend wires index access into every booth function and the photo processor', () => {
    const src = codeOnly(readSource('amplify/backend.ts'));
    for (const fn of ['boothSignupFn', 'boothScanFn', 'boothGalleryFn', 'boothDeliveriesFn']) {
      expect(src).toMatch(new RegExp(`\\[[^\\]]*\\b${fn}\\b[^\\]]*\\]\\)\\s*\\{\\s*fn\\.addToRolePolicy\\(indexReadStatement`));
    }
    expect(src).toContain('processProFn.addToRolePolicy(indexReadStatement(');
  });
});

// The #180 class of bug: a function that reads an env var or queries an index
// its role was never given. Checked for every function booth mode touches.
describe('booth functions get every env var and index they use', () => {
  const backend = codeOnly(readSource('amplify/backend.ts'));
  const FNS: Record<string, string> = {
    'booth-gallery': 'boothGalleryFn',
    'booth-scan': 'boothScanFn',
    'booth-signup': 'boothSignupFn',
    'booth-deliveries': 'boothDeliveriesFn',
    'process-pro-photo': 'processProFn',
    'decide-pro-photo': 'decideProFn',
    'list-event-photos': 'listFn',
  };
  // Read with a built-in default and never set for any function.
  const OPTIONAL = new Set(['AWS_REGION', 'REMINDER_REPLY_TO']);
  const { readdirSync } = jest.requireActual<typeof import('fs')>('fs');
  for (const [dir, fn] of Object.entries(FNS)) {
    it(`${dir}: env vars are set on ${fn}`, () => {
      const used = new Set<string>();
      for (const f of readdirSync(`amplify/functions/${dir}`).filter((n) => n.endsWith('.ts'))) {
        for (const m of readSource(`amplify/functions/${dir}/${f}`).matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]);
      }
      const missing = [...used].filter(
        (v) => !new RegExp(`${fn}\\.addEnvironment\\(\\s*'${v}'`).test(backend) && !OPTIONAL.has(v),
      );
      expect({ dir, missing }).toEqual({ dir, missing: [] });
    });
  }

  it('the guest-link query (new token-index lookup) runs on the gallery function, which can query attendee indexes and open offline codes', () => {
    const schema = readSource('amplify/data/resource.ts');
    expect(schema).toMatch(/boothGuestLink: a[\s\S]*?\.handler\(a\.handler\.function\(boothGalleryFn\)\)/);
    expect(backend).toMatch(/boothIndexTables = \[boothAttendeeTable\.tableArn/);
    expect(backend).toContain("boothGalleryFn.addEnvironment('BOOTH_PRIVATE_KEY'");
    expect(backend).toContain('eventTable.grantReadWriteData(processProFn)'); // boothStartedAt
    expect(backend).toContain('eventTable.grantReadWriteData(boothScanFn)'); // boothStartedAt
    expect(backend).toContain('photoTable.grantReadWriteData(decideProFn)'); // publishing
  });
});
