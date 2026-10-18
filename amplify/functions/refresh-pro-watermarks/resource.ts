import { defineFunction } from '@aws-amplify/backend';

/**
 * The photographer's "redo my watermarks" call, from the profile page after a
 * save. Hands the work to restamp-pro-photos asynchronously and returns at
 * once; re-stamping hundreds of previews outlasts a GraphQL request.
 */
export const refreshProWatermarks = defineFunction({
  name: 'refresh-pro-watermarks',
  resourceGroupName: 'data',
});
