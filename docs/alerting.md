# Operational alerting

SharePix emails an operator when a critical Lambda starts failing, so a broken
payment webhook (or a failing checkout / print / upload path) surfaces
immediately instead of via a customer complaint.

## What's watched

Defined in `amplify/backend.ts`. Each alarm publishes to one SNS topic
(`SharepixAlerts`, ARN is exported as `custom.alertsTopicArn`):

| Alarm | Fires when |
| --- | --- |
| `sharepix-webhook-errors` | The Stripe webhook Lambda throws or times out |
| `sharepix-webhook-handled-failures` | The webhook logs **two or more** `Failed to …` errors in five minutes (a payment/event side effect wasn't recorded — these return HTTP 500 rather than throwing, so they don't show on the Lambda error metric) |
| `sharepix-checkout-errors` | The Stripe checkout Lambda throws (a host couldn't start payment) |
| `sharepix-print-fulfill-errors` | Print fulfilment to Prodigi throws |
| `sharepix-sanitize-errors` | The upload sanitizer crashes or times out |

All alarms evaluate a 5-minute window and treat "no data" as healthy.

Every alarm fires on a single occurrence except `webhook-handled-failures`,
which needs **two in one window**. A lone handled failure is usually a guest
interrupting their own checkout — a back button pressed mid-payment produced
exactly that — and paging on those teaches you to ignore the alerts. Thrown
errors and timeouts are never self-inflicted, so those still page on the first
one.

## Turning on the emails

1. In the Amplify app's **Environment variables**, add `ALERT_EMAIL` set to the
   address that should receive alerts, then redeploy. On deploy, AWS sends a
   one-time **"Subscription Confirmation"** email from SNS — click the confirm
   link in it, or you won't receive alarms.
2. To add more recipients (or a Slack/PagerDuty endpoint) later, subscribe them
   to the `SharepixAlerts` SNS topic in the AWS console — the topic deploys even
   when `ALERT_EMAIL` is unset.

## Note

Stripe also emails you when a webhook endpoint is failing, so the
`webhook-handled-failures` alarm is a second, faster signal — not the only one.
