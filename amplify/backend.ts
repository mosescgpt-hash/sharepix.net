import { defineBackend } from '@aws-amplify/backend';
import { Function as LambdaFunction, FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { deleteEventPhoto } from './functions/delete-event-photo/resource';
import { createEventPhoto } from './functions/create-event-photo/resource';
import { stripeCheckout } from './functions/stripe-checkout/resource';
import { printCheckout } from './functions/print-checkout/resource';
import { listEventPhotos } from './functions/list-event-photos/resource';
import { adminUserActions } from './functions/admin-user-actions/resource';
import { stripeWebhook } from './functions/stripe-webhook/resource';
import { corporatePortal } from './functions/corporate-portal/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  deleteEventPhoto,
  createEventPhoto,
  stripeCheckout,
  printCheckout,
  listEventPhotos,
  adminUserActions,
  stripeWebhook,
  corporatePortal,
});

const eventTable = backend.data.resources.tables.Event;
const photoTable = backend.data.resources.tables.Photo;
const paymentTable = backend.data.resources.tables.Payment;
const corporateTable = backend.data.resources.tables.CorporateSubscription;
const printOrderTable = backend.data.resources.tables.PrintOrder;
const bucket = backend.storage.resources.bucket;

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

// Print-checkout function: guest-facing print order → Stripe checkout. Reads the
// event to enforce the guest-download gate and writes a pending PrintOrder row
// the webhook later submits to Prodigi. No S3 or photo-table access needed — it
// validates photo ownership by the s3Key prefix, like createEventPhoto.
const printCheckoutFn = backend.printCheckout.resources.lambda as LambdaFunction;
eventTable.grantReadData(printCheckoutFn);
printOrderTable.grantWriteData(printCheckoutFn);
printCheckoutFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
printCheckoutFn.addEnvironment('PRINT_ORDER_TABLE_NAME', printOrderTable.tableName);

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
// Prints fulfillment: read/update the PrintOrder row and read the photo objects
// to mint signed URLs Prodigi pulls the originals from.
printOrderTable.grantReadWriteData(webhookFn);
bucket.grantRead(webhookFn);
webhookFn.addEnvironment('PAYMENT_TABLE_NAME', paymentTable.tableName);
webhookFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
webhookFn.addEnvironment('CORPORATE_TABLE_NAME', corporateTable.tableName);
webhookFn.addEnvironment('PRINT_ORDER_TABLE_NAME', printOrderTable.tableName);
webhookFn.addEnvironment('BUCKET_NAME', bucket.bucketName);
const webhookUrl = webhookFn.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
});

// Corporate billing portal: reads the caller's Stripe customer id from their
// subscription row, then opens Stripe's hosted portal to manage/cancel.
const corporatePortalFn = backend.corporatePortal.resources.lambda as LambdaFunction;
corporateTable.grantReadData(corporatePortalFn);
corporatePortalFn.addEnvironment('CORPORATE_TABLE_NAME', corporateTable.tableName);

backend.addOutput({
  custom: {
    stripeWebhookUrl: webhookUrl.url,
  },
});
