import { defineBackend } from '@aws-amplify/backend';
import { Duration } from 'aws-cdk-lib';
import { Function as LambdaFunction, FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { LogGroup, MetricFilter, FilterPattern } from 'aws-cdk-lib/aws-logs';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { deleteEventPhoto } from './functions/delete-event-photo/resource';
import { createEventPhoto } from './functions/create-event-photo/resource';
import { createEvent } from './functions/create-event/resource';
import { updateEvent } from './functions/update-event/resource';
import { stripeCheckout } from './functions/stripe-checkout/resource';
import { printCheckout } from './functions/print-checkout/resource';
import { printFulfill } from './functions/print-fulfill/resource';
import { printProviderCheck } from './functions/print-provider-check/resource';
import { sendTestAlert } from './functions/send-test-alert/resource';
import { listEventPhotos } from './functions/list-event-photos/resource';
import { adminUserActions } from './functions/admin-user-actions/resource';
import { stripeWebhook } from './functions/stripe-webhook/resource';
import { corporatePortal } from './functions/corporate-portal/resource';
import { sanitizeUpload } from './functions/sanitize-upload/resource';
import { mediaUrl } from './functions/media-url/resource';
import { moderatePhoto } from './functions/moderate-photo/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  deleteEventPhoto,
  createEventPhoto,
  createEvent,
  updateEvent,
  stripeCheckout,
  printCheckout,
  printFulfill,
  printProviderCheck,
  sendTestAlert,
  listEventPhotos,
  adminUserActions,
  stripeWebhook,
  corporatePortal,
  sanitizeUpload,
  mediaUrl,
  moderatePhoto,
});

const eventTable = backend.data.resources.tables.Event;
const photoTable = backend.data.resources.tables.Photo;
const paymentTable = backend.data.resources.tables.Payment;
const corporateTable = backend.data.resources.tables.CorporateSubscription;
const printOrderTable = backend.data.resources.tables.PrintOrder;
const discountTable = backend.data.resources.tables.DiscountCode;
const reviewTable = backend.data.resources.tables.ModerationReview;
const hostProfileTable = backend.data.resources.tables.HostProfile;
const bucket = backend.storage.resources.bucket;

// Point-in-time recovery on every data table: continuous backups that let us
// restore any table to any second within the last 35 days, so a bad write, a
// bug, or an accidental bulk delete can be rolled back instead of lost.
// Amplify Gen2 tables are managed AmplifyDynamoDbTable resources (not plain
// CfnTables), so PITR is set through cfnResources.amplifyDynamoDbTables.
const { amplifyDynamoDbTables } = backend.data.resources.cfnResources;
for (const table of Object.values(amplifyDynamoDbTables)) {
  table.pointInTimeRecoveryEnabled = true;
}

// Storage lifecycle. Without this, every photo/video stays in S3 forever —
// the bill grows without bound and we hold guests' personal media long past
// what any plan promises. Two rules:
//   1. Clean up abandoned multipart uploads after 7 days (pure cost savings;
//      never touches a completed object).
//   2. A hard backstop that expires event media well beyond the longest
//      legitimate event lifecycle (≈485 days: 30-day upload window + up to
//      365-day host retention + 90-day archive). 800 days leaves comfortable
//      margin for extensions, so no normal event is ever cut short — it only
//      guarantees nothing lives in the bucket indefinitely.
const s3Bucket = bucket as Bucket;
s3Bucket.addLifecycleRule({
  id: 'abort-incomplete-multipart-uploads',
  enabled: true,
  abortIncompleteMultipartUploadAfter: Duration.days(7),
});
s3Bucket.addLifecycleRule({
  id: 'expire-event-media-backstop',
  enabled: true,
  prefix: 'events/',
  expiration: Duration.days(800),
});

// Upload sanitizer (storage onUpload trigger): validates each uploaded object's
// real type, deletes anything disguised or oversize, and rewrites JPEG originals
// with their location metadata removed. Needs read + write + delete on the
// bucket; the trigger wiring itself is set up by defineStorage.
const sanitizeFn = backend.sanitizeUpload.resources.lambda as LambdaFunction;
bucket.grantReadWrite(sanitizeFn);
bucket.grantDelete(sanitizeFn);
// Cloudflare R2 mirror. Uploads are still vetted in S3; once the bytes are
// final this copies them to R2, which is where reads get served from because
// its egress is free. Every value is optional: with any of them unset the
// mirror is inert and SharePix serves from S3 exactly as before.
sanitizeFn.addEnvironment('R2_ACCOUNT_ENDPOINT', process.env.R2_ACCOUNT_ENDPOINT ?? '');
sanitizeFn.addEnvironment('R2_BUCKET', process.env.R2_BUCKET ?? '');
sanitizeFn.addEnvironment('R2_ACCESS_KEY_ID', process.env.R2_ACCESS_KEY_ID ?? '');
sanitizeFn.addEnvironment('R2_SECRET_ACCESS_KEY', process.env.R2_SECRET_ACCESS_KEY ?? '');

// Signs R2 URLs for the gallery and downloads. Reads the event row to decide
// what a caller may have, and holds the same R2 credentials as the mirror —
// with them unset it returns nothing and every caller falls back to S3.
const mediaUrlFn = backend.mediaUrl.resources.lambda as LambdaFunction;
eventTable.grantReadData(mediaUrlFn);
mediaUrlFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
mediaUrlFn.addEnvironment('R2_ACCOUNT_ENDPOINT', process.env.R2_ACCOUNT_ENDPOINT ?? '');
mediaUrlFn.addEnvironment('R2_BUCKET', process.env.R2_BUCKET ?? '');
mediaUrlFn.addEnvironment('R2_ACCESS_KEY_ID', process.env.R2_ACCESS_KEY_ID ?? '');
mediaUrlFn.addEnvironment('R2_SECRET_ACCESS_KEY', process.env.R2_SECRET_ACCESS_KEY ?? '');

// Delete function: remove the S3 objects + photo record and free a slot on the
// event counter. It never needs broad S3 delete rights handed to every user.
const deleteFn = backend.deleteEventPhoto.resources.lambda as LambdaFunction;
photoTable.grantReadWriteData(deleteFn);
eventTable.grantReadWriteData(deleteFn);
bucket.grantDelete(deleteFn);
deleteFn.addEnvironment('PHOTO_TABLE_NAME', photoTable.tableName);
deleteFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
deleteFn.addEnvironment('BUCKET_NAME', bucket.bucketName);

// Create function: stamp ownership from the event and enforce the photo limit
// atomically. Needs to read the event, bump its counter, and write the photo.
// Photo reads are for the duplicate check — it looks up the content-derived id
// before writing, and again if it loses the race for it.
const createFn = backend.createEventPhoto.resources.lambda as LambdaFunction;
eventTable.grantReadWriteData(createFn);
photoTable.grantReadWriteData(createFn);
createFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
createFn.addEnvironment('PHOTO_TABLE_NAME', photoTable.tableName);
// Content screening: Rekognition reads the uploaded object straight from S3, so
// the function needs bucket read plus the single detection action. Photos held
// for review are hidden from guests until the host releases them.
bucket.grantRead(createFn);
createFn.addEnvironment('BUCKET_NAME', bucket.bucketName);
createFn.addToRolePolicy(
  new PolicyStatement({
    actions: ['rekognition:DetectModerationLabels'],
    // DetectModerationLabels acts on the image passed in the request, not on a
    // named resource ARN, so it can't be scoped further than '*'.
    resources: ['*'],
  }),
);
// Opens a review link when a photo is held back, so the host can decide from an
// alert without signing in.
reviewTable.grantWriteData(createFn);
createFn.addEnvironment('REVIEW_TABLE_NAME', reviewTable.tableName);
// Emails the host when a photo is held, with the preview embedded and buttons
// linking to the review page. ALERT_FROM_ADDRESS must be a verified SES
// identity; leaving it unset simply disables the emails (see docs/alerting.md).
createFn.addEnvironment('APP_URL', process.env.APP_URL ?? 'https://www.sharepix.net');
createFn.addEnvironment('ALERT_FROM_ADDRESS', process.env.ALERT_FROM_ADDRESS ?? '');
// Optional: where host replies to an alert go, when the From is send-only.
createFn.addEnvironment('ALERT_REPLY_TO', process.env.ALERT_REPLY_TO ?? '');
createFn.addToRolePolicy(
  new PolicyStatement({
    // The alert is raw MIME (preview inlined as multipart/related), and IAM
    // authorizes raw sends under `ses:SendRawEmail`, NOT `ses:SendEmail` —
    // different action names for what looks like the same API. Both are granted
    // so a future switch to simple content still works.
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: ['*'],
  }),
);

// Create-event function: the only thing that writes an Event row. It reads the
// caller's Corporate subscription and the discount code they named to decide
// whether the event starts active — the two ways to open one without paying —
// and reads their HostProfile only for the display name shown as the host.
//
// Write-only on the event table: it creates rows and never needs to read one,
// which keeps this function from becoming a way to enumerate other hosts'
// events. The discount table is read-write because a comped event spends a use
// of the code in the same request.
const createEventFn = backend.createEvent.resources.lambda as LambdaFunction;
eventTable.grantWriteData(createEventFn);
corporateTable.grantReadData(createEventFn);
discountTable.grantReadWriteData(createEventFn);
hostProfileTable.grantReadData(createEventFn);
createEventFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
createEventFn.addEnvironment('CORPORATE_TABLE_NAME', corporateTable.tableName);
createEventFn.addEnvironment('DISCOUNT_TABLE_NAME', discountTable.tableName);
createEventFn.addEnvironment('HOST_PROFILE_TABLE_NAME', hostProfileTable.tableName);

// Update-event function: the only way a host changes their own event, now that
// the model grants owners no `update`. It reads the row to check ownership and
// the photo count (which locks the name and date), then writes back only the
// fields on its allow-list.
const updateEventFn = backend.updateEvent.resources.lambda as LambdaFunction;
eventTable.grantReadWriteData(updateEventFn);
updateEventFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);

// Test-alert function: sends the same held-photo alert to the admin who asked
// for it, so delivery can be checked without waiting for a photo to be flagged.
// Configured from the SAME values as createFn above — a test that ran with a
// different sender, region or app URL would prove nothing about the real path.
// It reads a photo row and its preview only to embed a realistic image.
const testAlertFn = backend.sendTestAlert.resources.lambda as LambdaFunction;
photoTable.grantReadData(testAlertFn);
bucket.grantRead(testAlertFn);
testAlertFn.addEnvironment('PHOTO_TABLE_NAME', photoTable.tableName);
testAlertFn.addEnvironment('BUCKET_NAME', bucket.bucketName);
testAlertFn.addEnvironment('APP_URL', process.env.APP_URL ?? 'https://www.sharepix.net');
testAlertFn.addEnvironment('ALERT_FROM_ADDRESS', process.env.ALERT_FROM_ADDRESS ?? '');
testAlertFn.addEnvironment('ALERT_REPLY_TO', process.env.ALERT_REPLY_TO ?? '');
// The recipient is the caller's own email, which the data client's access token
// does not carry — so it is read from Cognito, scoped to this pool.
testAlertFn.addEnvironment('USER_POOL_ID', backend.auth.resources.userPool.userPoolId);
testAlertFn.addToRolePolicy(
  new PolicyStatement({
    // Raw MIME send — see the createFn grant above for why SendRawEmail.
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: ['*'],
  }),
);
testAlertFn.addToRolePolicy(
  new PolicyStatement({
    actions: ['cognito-idp:AdminGetUser'],
    resources: [backend.auth.resources.userPool.userPoolArn],
  }),
);

// Moderate-photo function: decides a flagged photo from a review link. It reads
// and closes the review, and flips the photo's status — nothing else.
const moderateFn = backend.moderatePhoto.resources.lambda as LambdaFunction;
reviewTable.grantReadWriteData(moderateFn);
photoTable.grantReadWriteData(moderateFn);
moderateFn.addEnvironment('REVIEW_TABLE_NAME', reviewTable.tableName);
moderateFn.addEnvironment('PHOTO_TABLE_NAME', photoTable.tableName);

// Print-checkout function: guest-facing print order → Stripe checkout. Reads the
// event to enforce the guest-download gate and writes a pending PrintOrder row
// the webhook later submits to Prodigi. No S3 or photo-table access needed — it
// validates photo ownership by the s3Key prefix, like createEventPhoto.
const printCheckoutFn = backend.printCheckout.resources.lambda as LambdaFunction;
eventTable.grantReadData(printCheckoutFn);
printOrderTable.grantWriteData(printCheckoutFn);
printCheckoutFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
printCheckoutFn.addEnvironment('PRINT_ORDER_TABLE_NAME', printOrderTable.tableName);

// Stripe checkout function: reads the event's tier to enforce that only
// Premium/Corporate events can buy the guest-download add-on, and reads the
// DiscountCode table to validate a code and apply it as a Stripe coupon.
const stripeCheckoutFn = backend.stripeCheckout.resources.lambda as LambdaFunction;
eventTable.grantReadData(stripeCheckoutFn);
discountTable.grantReadData(stripeCheckoutFn);
stripeCheckoutFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
stripeCheckoutFn.addEnvironment('DISCOUNT_TABLE_NAME', discountTable.tableName);

// Print-fulfill function: the background worker that submits a paid order to
// Prodigi (invoked async by the webhook). It reads/updates the PrintOrder row
// and reads the photo objects to mint the signed URLs Prodigi pulls from.
const printFulfillFn = backend.printFulfill.resources.lambda as LambdaFunction;
printOrderTable.grantReadWriteData(printFulfillFn);
bucket.grantRead(printFulfillFn);
printFulfillFn.addEnvironment('PRINT_ORDER_TABLE_NAME', printOrderTable.tableName);
printFulfillFn.addEnvironment('BUCKET_NAME', bucket.bucketName);

// List function: read one event's photos for the public gallery (read-only).
const listFn = backend.listEventPhotos.resources.lambda as LambdaFunction;
photoTable.grantReadData(listFn);
listFn.addEnvironment('PHOTO_TABLE_NAME', photoTable.tableName);

// Admin user-actions function: reset passwords and enable/disable accounts in
// the Cognito user pool. Scoped to just these admin operations on this pool.
const userPool = backend.auth.resources.userPool;
const adminFn = backend.adminUserActions.resources.lambda as LambdaFunction;
adminFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
adminFn.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'cognito-idp:ListUsers',
      'cognito-idp:AdminResetUserPassword',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminDisableUser',
    ],
    resources: [userPool.userPoolArn],
  }),
);

// Stripe webhook: a public Function URL Stripe calls when a checkout completes.
// It verifies the signature, then writes a Payment row (table write only — no
// broad data access). The URL is unauthenticated because Stripe can't send AWS
// credentials; the Stripe signature check is what authenticates each request.
const webhookFn = backend.stripeWebhook.resources.lambda as LambdaFunction;
paymentTable.grantWriteData(webhookFn);
eventTable.grantWriteData(webhookFn);
corporateTable.grantWriteData(webhookFn);
// Counts a discount-code redemption (usedCount) once payment completes.
discountTable.grantWriteData(webhookFn);
webhookFn.addEnvironment('DISCOUNT_TABLE_NAME', discountTable.tableName);
// Prints: the webhook only hands the order off to print-fulfill (async), so it
// needs invoke permission on it — not PrintOrder/bucket access anymore.
printFulfillFn.grantInvoke(webhookFn);
webhookFn.addEnvironment('PAYMENT_TABLE_NAME', paymentTable.tableName);
webhookFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
webhookFn.addEnvironment('CORPORATE_TABLE_NAME', corporateTable.tableName);
webhookFn.addEnvironment('PRINT_FULFILL_FUNCTION_NAME', printFulfillFn.functionName);
const webhookUrl = webhookFn.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
});

// Corporate billing portal: reads the caller's Stripe customer id from their
// subscription row, then opens Stripe's hosted portal to manage/cancel.
const corporatePortalFn = backend.corporatePortal.resources.lambda as LambdaFunction;
corporateTable.grantReadData(corporatePortalFn);
corporatePortalFn.addEnvironment('CORPORATE_TABLE_NAME', corporateTable.tableName);

// ---------------------------------------------------------------------------
// Alerting. A broken webhook means payments stop being recorded and events
// stop activating — the kind of failure you don't want to hear about from a
// customer. These CloudWatch alarms email an operator the moment a critical
// function starts failing.
//
// Set an ALERT_EMAIL environment variable on the Amplify app to receive the
// emails (then confirm the one-time SNS subscription email AWS sends). Without
// it the topic and alarms still deploy; subscribe an endpoint in the SNS
// console whenever you're ready.
// ---------------------------------------------------------------------------
const alertsTopic = new Topic(backend.stack, 'SharepixAlerts', {
  displayName: 'SharePix alerts',
});
const alertEmail = process.env.ALERT_EMAIL;
if (alertEmail) {
  alertsTopic.addSubscription(new EmailSubscription(alertEmail));
}

// Fire when a function throws/times out (unhandled failures). checkout and
// print-fulfill throw on error, so this covers their failures directly; the
// sanitizer and webhook are covered for crashes and timeouts.
function errorRateAlarm(id: string, fn: LambdaFunction, label: string) {
  const alarm = new Alarm(backend.stack, id, {
    alarmName: `sharepix-${id}`,
    alarmDescription: `${label} is throwing errors.`,
    metric: fn.metricErrors({ period: Duration.minutes(5) }),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
  alarm.addAlarmAction(new SnsAction(alertsTopic));
}
errorRateAlarm('webhook-errors', webhookFn, 'Stripe webhook');
errorRateAlarm('checkout-errors', stripeCheckoutFn, 'Stripe checkout');
errorRateAlarm('print-fulfill-errors', printFulfillFn, 'Print fulfilment');
errorRateAlarm('sanitize-errors', sanitizeFn, 'Upload sanitizer');
// A failure here means a host paid (or tried to) and got no event, or a comped
// code was spent on nothing. It throws on every refusal path, so this covers it.
errorRateAlarm('create-event-errors', createEventFn, 'Event creation');
// Settings changes are the host's only write path to their own event, so a
// failure here locks them out of their own dashboard. It returns a message
// rather than throwing for anything the host did wrong, so this only fires on
// real faults.
errorRateAlarm('update-event-errors', updateEventFn, 'Event settings');

// The R2 mirror is best-effort by design: an upload that can't be copied is
// still safe and serveable from S3, so the sanitizer catches the error rather
// than throwing it. That is the right behaviour for a guest mid-upload and the
// wrong behaviour for us — a revoked or mistyped R2 token would stop every new
// object reaching R2 and the only symptom would be the S3 bill quietly coming
// back. Nothing above would fire, because nothing failed.
//
// So turn the mirror's own error log into a metric and alarm on it. The log
// group is imported by name so we don't alter the function's logging config —
// same approach as the webhook filter below.
const sanitizeLogGroup = LogGroup.fromLogGroupName(
  backend.stack,
  'SanitizeLogGroupRef',
  `/aws/lambda/${sanitizeFn.functionName}`,
);
new MetricFilter(backend.stack, 'MirrorFailureFilter', {
  logGroup: sanitizeLogGroup,
  metricNamespace: 'SharePix/Mirror',
  metricName: 'MirrorFailures',
  filterPattern: FilterPattern.literal('"Could not mirror to R2"'),
  metricValue: '1',
  defaultValue: 0,
});
const mirrorFailureAlarm = new Alarm(backend.stack, 'r2-mirror-failures', {
  alarmName: 'sharepix-r2-mirror-failures',
  alarmDescription:
    'Uploads are not reaching Cloudflare R2 — check the R2 credentials and bucket. Reads still fall back to S3, so this costs money rather than breaking anything.',
  metric: new Metric({
    namespace: 'SharePix/Mirror',
    metricName: 'MirrorFailures',
    period: Duration.minutes(5),
    statistic: 'Sum',
  }),
  // Three in five minutes. One is a transient network blip on a single object,
  // and the object is still readable from S3, so paging on it would train the
  // operator to ignore this alarm. Three means the credentials or the bucket
  // are wrong and nothing is being mirrored at all.
  threshold: 3,
  evaluationPeriods: 1,
  comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: TreatMissingData.NOT_BREACHING,
});
mirrorFailureAlarm.addAlarmAction(new SnsAction(alertsTopic));

// The webhook handles its own errors and returns HTTP 500 (so Stripe retries)
// rather than throwing, so those money-critical failures never show up on the
// Lambda Errors metric above. Turn its "Failed to …" error logs into a metric
// and alarm on that too. The log group is imported by name so we don't alter
// the function's own logging config.
const webhookLogGroup = LogGroup.fromLogGroupName(
  backend.stack,
  'WebhookLogGroupRef',
  `/aws/lambda/${webhookFn.functionName}`,
);
new MetricFilter(backend.stack, 'WebhookFailureFilter', {
  logGroup: webhookLogGroup,
  metricNamespace: 'SharePix/Webhook',
  metricName: 'HandledFailures',
  filterPattern: FilterPattern.literal('"Failed to"'),
  metricValue: '1',
  defaultValue: 0,
});
const webhookFailureAlarm = new Alarm(backend.stack, 'webhook-handled-failures', {
  alarmName: 'sharepix-webhook-handled-failures',
  alarmDescription:
    'The Stripe webhook logged repeated failures — payments or event side effects are not being recorded.',
  metric: new Metric({
    namespace: 'SharePix/Webhook',
    metricName: 'HandledFailures',
    period: Duration.minutes(5),
    statistic: 'Sum',
  }),
  // Two in five minutes, not one. A single handled failure is usually someone
  // interrupting their own checkout (a back button mid-payment produced exactly
  // that), and paging on those trains the operator to ignore the alerts. Two in
  // one window means something systematic. Note this only relaxes the
  // log-derived alarm: the Lambda error alarms above still fire on a single
  // thrown error or timeout, which is never self-inflicted.
  threshold: 2,
  evaluationPeriods: 1,
  comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: TreatMissingData.NOT_BREACHING,
});
webhookFailureAlarm.addAlarmAction(new SnsAction(alertsTopic));

backend.addOutput({
  custom: {
    stripeWebhookUrl: webhookUrl.url,
    alertsTopicArn: alertsTopic.topicArn,
  },
});
