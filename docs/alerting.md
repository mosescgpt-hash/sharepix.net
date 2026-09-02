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
| `sharepix-create-event-errors` | Event creation throws (a host got no event, or a comped code was spent on nothing) |
| `sharepix-print-order-failures` | A **paid** print order was not placed with Prodigi — the customer was charged and nothing is being printed |
| `sharepix-r2-mirror-failures` | The sanitizer logs **three or more** `Could not mirror to R2` errors in five minutes — new uploads aren't reaching Cloudflare R2 |

All alarms evaluate a 5-minute window and treat "no data" as healthy.

Every alarm fires on a single occurrence except two. `webhook-handled-failures`
needs **two in one window**: a lone handled failure is usually a guest
interrupting their own checkout — a back button pressed mid-payment produced
exactly that — and paging on those teaches you to ignore the alerts.
`r2-mirror-failures` needs **three**, because one is a transient blip on a
single object and that object still reads fine from S3. Thrown errors and
timeouts are never self-inflicted, so those still page on the first one.

### Why print fulfilment needs a log-derived alarm

`print-fulfill-errors` watches the Lambda's error metric, and print-fulfill
never reaches it: the whole handler body sits inside a `try/catch` that records
`status: failed` on the order row and returns normally. A Prodigi rejection, a
missing `PRODIGI_API_KEY` and a missing order row all leave the error metric at
zero. That was the most expensive silent failure in the product — the customer
has paid, nothing is being printed, and nobody is told — so the log lines that
mean exactly that are the alarm instead.

**When it fires:** find the order in the `PrintOrder` table with
`status = "failed"`; the reason is in its `error` field. Either fix the cause
and resubmit, or refund the customer. Don't wait for them to ask.

### Why the R2 mirror needs a log-derived alarm

The mirror is best-effort on purpose: an upload that can't be copied to R2 is
still safe and serveable from S3, so the sanitizer catches the error rather than
throwing it. That is right for the guest mid-upload and wrong for you — a
revoked or mistyped R2 token would stop every new object reaching R2, and the
only symptom would be the S3 egress bill quietly coming back. Nothing on the
Lambda error metric would fire, because nothing failed. Hence the metric filter
on the log line. Same reasoning as `webhook-handled-failures`.

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
