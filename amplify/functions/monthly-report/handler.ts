// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import {
  NOT_MEASURED,
  figuresFor,
  headline,
  reportLines,
  reportMonths,
  type ReportEvent,
  type ReportIncentive,
} from './monthlyReport';

const dynamo = new DynamoDBClient({});
const ses = new SESv2Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const INCENTIVE_TABLE = process.env.INCENTIVE_TABLE_NAME as string;
const APP_URL = (process.env.APP_URL ?? 'https://www.sharepix.net').replace(/\/+$/, '');
const FROM_ADDRESS = process.env.ALERT_FROM_ADDRESS ?? '';
/** Who gets it. Unset means nothing is sent — the report ships off, like every send here. */
const TO_ADDRESS = process.env.REPORT_TO_ADDRESS ?? '';

/** Escape text interpolated into the HTML body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function scanAll<T>(
  table: string,
  projection: string,
  names: Record<string, string> | undefined,
  read: (item: Record<string, AttributeValue>) => T,
): Promise<T[]> {
  if (!table) return [];
  const rows: T[] = [];
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: table,
        ExclusiveStartKey: startKey,
        ProjectionExpression: projection,
        ...(names ? { ExpressionAttributeNames: names } : {}),
      }),
    );
    for (const item of page.Items ?? []) rows.push(read(item));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return rows;
}

export const handler = async () => {
  const now = new Date();
  const { current, previous } = reportMonths(now);

  const events = await scanAll<ReportEvent>(
    EVENT_TABLE,
    'createdAt, tier, #source, paid, contributorCount, guestUploadCount',
    // `source` is a reserved word in DynamoDB expressions.
    { '#source': 'source' },
    (item) => ({
      createdAt: item.createdAt?.S ?? null,
      tier: item.tier?.S ?? null,
      source: item.source?.S ?? null,
      paid: item.paid?.BOOL !== false,
      contributorCount: Number(item.contributorCount?.N ?? '0'),
      guestUploadCount: Number(item.guestUploadCount?.N ?? '0'),
    }),
  );

  const incentives = await scanAll<ReportIncentive>(
    INCENTIVE_TABLE,
    '#status, amountUsd, completedAt',
    { '#status': 'status' },
    (item) => ({
      status: item.status?.S ?? null,
      amountUsd: Number(item.amountUsd?.N ?? '0'),
      completedAt: item.completedAt?.S ?? null,
    }),
  );

  const figures = figuresFor(events, incentives, current);
  const before = figuresFor(events, incentives, previous);
  const lines = reportLines(figures, before);
  const lead = headline(figures, before);

  const subject = `SharePix — ${current.label}`;
  const text = [
    `SharePix, ${current.label} (compared with ${previous.label})`,
    '',
    lead,
    '',
    ...lines.map((l) => `${l.label}: ${l.value}${l.change ? ` (${l.change})` : ''}`),
    '',
    figures.rewardsOwedUsd > 0
      ? `Gift cards owed right now: $${figures.rewardsOwedUsd}. These are sent by hand.`
      : 'No gift cards owed.',
    '',
    'Not in this report, because nothing measures it yet:',
    ...NOT_MEASURED.map((item) => `  - ${item}`),
    '',
    `${APP_URL}/global-admin`,
  ].join('\n');

  const html = [
    '<!doctype html><html><body style="margin:0;background:#faf9f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2421">',
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px">',
    '<p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#0b7a52;margin:0 0 12px">SharePix</p>',
    `<h1 style="font-size:24px;line-height:1.25;margin:0 0 8px">${escapeHtml(current.label)}</h1>`,
    `<p style="font-size:13px;color:#1f2421;opacity:.6;margin:0 0 20px">Compared with ${escapeHtml(previous.label)}</p>`,
    lead
      ? `<p style="font-size:16px;line-height:1.5;margin:0 0 24px"><strong>${escapeHtml(lead)}</strong></p>`
      : '',
    '<table style="width:100%;border-collapse:collapse;font-size:15px">',
    ...lines.map(
      (l) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid rgba(31,36,33,.1)">${escapeHtml(l.label)}</td>` +
        `<td style="padding:8px 0;border-bottom:1px solid rgba(31,36,33,.1);text-align:right;font-weight:600">${escapeHtml(l.value)}</td>` +
        `<td style="padding:8px 0 8px 12px;border-bottom:1px solid rgba(31,36,33,.1);text-align:right;color:#1f2421;opacity:.55;font-size:13px">${escapeHtml(l.change)}</td></tr>`,
    ),
    '</table>',
    figures.rewardsOwedUsd > 0
      ? `<p style="font-size:15px;line-height:1.6;margin:24px 0 0"><strong>$${figures.rewardsOwedUsd} of gift cards owed right now.</strong> These are sent by hand — nothing sends them for you.</p>`
      : '',
    '<h2 style="font-size:14px;margin:32px 0 8px">Not in this report</h2>',
    '<p style="font-size:13px;line-height:1.6;color:#1f2421;opacity:.6;margin:0 0 8px">Nothing measures these yet, so they are absent rather than zero:</p>',
    `<ul style="font-size:13px;line-height:1.6;color:#1f2421;opacity:.6;margin:0;padding-left:18px">${NOT_MEASURED.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`,
    `<p style="margin:28px 0 0"><a href="${APP_URL}/global-admin" style="color:#0b7a52">Open the dashboard</a></p>`,
    '</div></body></html>',
  ]
    .filter(Boolean)
    .join('');

  if (!TO_ADDRESS || !FROM_ADDRESS) {
    // Same posture as every other send here: it runs, decides, logs, and sends
    // nothing until someone turns it on.
    console.log('[dry-run] monthly report not sent (no recipient configured)', {
      at: now.toISOString(),
      month: current.label,
      subject,
      eventsCreated: figures.eventsCreated,
    });
    return {
      ok: true,
      dryRun: true,
      summary: `${current.label}: ${figures.eventsCreated} event${figures.eventsCreated === 1 ? '' : 's'}, ${figures.successfulEvents} successful. Nothing was sent — no REPORT_TO_ADDRESS is configured.`,
    };
  }

  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_ADDRESS,
        Destination: { ToAddresses: [TO_ADDRESS] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: html, Charset: 'UTF-8' },
              Text: { Data: text, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
  } catch (error) {
    console.error('Could not send the monthly report', {
      at: now.toISOString(),
      month: current.label,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      dryRun: false,
      summary: `${current.label} was built but could not be emailed. The error is in the function's logs.`,
    };
  }

  console.log('Monthly report sent', { at: now.toISOString(), month: current.label });
  return {
    ok: true,
    dryRun: false,
    summary: `${current.label} sent to ${TO_ADDRESS}: ${figures.eventsCreated} event${figures.eventsCreated === 1 ? '' : 's'}, ${figures.successfulEvents} successful.`,
  };
};
