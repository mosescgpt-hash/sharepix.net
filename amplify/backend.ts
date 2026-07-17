import { defineBackend } from '@aws-amplify/backend';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { deleteEventPhoto } from './functions/delete-event-photo/resource';
import { createEventPhoto } from './functions/create-event-photo/resource';
import { stripeCheckout } from './functions/stripe-checkout/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  deleteEventPhoto,
  createEventPhoto,
  stripeCheckout,
});

const eventTable = backend.data.resources.tables.Event;
const photoTable = backend.data.resources.tables.Photo;
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
