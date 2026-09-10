import { defineFunction } from '@aws-amplify/backend';

/**
 * Records a host offering photos for marketing.
 *
 * Its own function because the row it writes is a consent record. A browser
 * that could write MarketingSubmission could grant itself permission to publish
 * somebody else's wedding, backdate a release, or claim a version of the
 * wording that was never shown. So the event's ownership is checked here, the
 * release version and timestamp are stamped here, and every asset starts
 * PENDING regardless of what was sent.
 */
export const submitMarketing = defineFunction({
  name: 'submit-marketing',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
