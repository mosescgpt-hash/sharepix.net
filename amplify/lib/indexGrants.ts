import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

/**
 * Read access to a table's secondary indexes. CDK's table.grantReadData only
 * adds `<table>/index/*` when it knows the table has indexes, and for the
 * booth tables (BoothAttendee, BoothScan) it did not: the deployed gallery
 * function was denied dynamodb:Query on boothAttendeesByGalleryKey, so every
 * "Their photos" link failed. This states the index access explicitly.
 */
export function indexReadStatement(tableArns: string[]): PolicyStatement {
  return new PolicyStatement({
    actions: ['dynamodb:Query', 'dynamodb:Scan'],
    resources: tableArns.map((arn) => `${arn}/index/*`),
  });
}
