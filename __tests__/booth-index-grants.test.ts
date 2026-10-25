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
