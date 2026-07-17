import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { deleteEventPhoto } from './functions/delete-event-photo/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  deleteEventPhoto,
});

// Grant the delete function exactly what it needs — read/write on the Photo
// table and delete on the photo bucket — instead of handing S3 delete rights
// to every signed-in user through the storage rules.
const photoTable = backend.data.resources.tables.Photo;
const bucket = backend.storage.resources.bucket;
const deleteFn = backend.deleteEventPhoto.resources.lambda as LambdaFunction;

photoTable.grantReadWriteData(deleteFn);
bucket.grantDelete(deleteFn);

deleteFn.addEnvironment('PHOTO_TABLE_NAME', photoTable.tableName);
deleteFn.addEnvironment('BUCKET_NAME', bucket.bucketName);
