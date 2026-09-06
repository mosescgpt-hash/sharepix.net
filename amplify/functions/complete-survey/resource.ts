import { defineFunction } from '@aws-amplify/backend';

/**
 * Records that someone finished the research survey.
 *
 * Its own function because the ResearchIncentive table is a queue of money we
 * owe: letting the browser write it would mean letting anyone with a link move
 * an obligation into any state, including FULFILLED. The token check and the
 * one legal transition both live here.
 *
 * What this creates is an obligation, never a payment. Nothing it does can mark
 * a gift card sent — a person does that, after looking at the survey response.
 */
export const completeSurvey = defineFunction({
  name: 'complete-survey',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
