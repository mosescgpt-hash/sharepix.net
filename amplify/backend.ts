import { defineBackend } from '@aws-amplify/backend';
import { Function as LambdaFunction, FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { deleteEventPhoto } from './functions/delete-event-photo/resource';
import { createEventPhoto } from './functions/create-event-photo/resource';
import { stripeCheckout } from './functions/stripe-checkout/resource';
import { listEventPhotos } from './functions/list-event-photos/resource';
import { adminUserActions } from './functions/admin-user-actions/resource';
import { stripeWebhook } from './functions/stripe-webhook/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  deleteEventPhoto,
  createEventPhoto,
  stripeCheckout,
  listEventPhotos,
  adminUserActions,
  stripeWebhook,
});

const eventTable = backend.data.resources.tables.Event;
const photoTable = backend.data.resources.tables.Photo;
const paymentTable = backend.data.resources.tables.Payment;
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
const createFn = backend.createEventPhoto.resources.lambda as LambdaFunction;
eventTable.grantReadWriteData(createFn);
photoTable.grantWriteData(createFn);
createFn.addEnvironment('EVENT_TABLE_NAME', eventTable.tableName);
createFn.addEnvironment('PHOTO_TABLE_NAME', photoTable.tableName);

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
webhookFn.addEnvironment('PAYMENT_TABLE_NAME', paymentTable.tableName);
const webhookUrl = webhookFn.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
});

backend.addOutput({
  custom: {
    stripeWebhookUrl: webhookUrl.url,
  },
});
