import { defineFunction } from '@aws-amplify/backend';

/**
 * Opens, saves and submits one host's post-event survey.
 *
 * One function rather than three because all three do the same dangerous thing
 * first: decode a link, load the row it names, and compare a token in constant
 * time before anything else happens. Split across three handlers that check
 * would exist three times, and the copy that drifted would be the hole.
 *
 * The row it writes carries a testimonial permission and a marketing-contact
 * answer, which is why hosts get no model-level write on SurveyResponse. A
 * browser that could write the table could grant itself permission to be
 * quoted, on somebody else's event, and the timestamp beside it would say a
 * person had agreed.
 */
export const surveyResponse = defineFunction({
  name: 'survey-response',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
