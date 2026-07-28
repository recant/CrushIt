import type { Directive, User } from './types.js';
import { money } from './util.js';

const NTFY_BASE_URL = process.env.NTFY_BASE_URL?.trim() || 'https://ntfy.sh';
const INKBOX_API_BASE = process.env.INKBOX_API_BASE_URL?.trim() || 'https://inkbox.ai/api/v1';

export function directiveMessage(directive: Directive): string {
  return [
    `TODAY'S REQUIRED ACTION: ${directive.title}`,
    directive.instruction,
    `Deadline: ${new Date(directive.deadline).toLocaleString('en-US')}`,
    `Proof: ${directive.evidenceRule.description}`,
    `Why: ${directive.whyThis}`,
    `Failure consequence: ${money(directive.penaltyCents)} from your commitment balance.`,
  ].join('\n\n');
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  return text ? `${response.status}: ${text.slice(0, 500)}` : String(response.status);
}

async function sendNtfy(body: string): Promise<void> {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) throw new Error('NTFY_TOPIC is required for ntfy delivery.');

  const response = await fetch(`${NTFY_BASE_URL.replace(/\/$/, '')}/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: {
      Title: "Today's required action",
      Priority: 'high',
      Tags: 'dart',
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body,
  });

  if (!response.ok) throw new Error(`ntfy delivery failed (${await responseError(response)})`);
}

function inkboxApiKey(): string {
  const value = process.env.INKBOX_API_KEY?.trim();
  if (!value) throw new Error('INKBOX_API_KEY is required for Inkbox delivery.');
  return value;
}

async function sendInkboxEmail(user: User, body: string): Promise<void> {
  const mailbox = process.env.INKBOX_EMAIL_ADDRESS?.trim();
  if (!mailbox || !user.email) {
    throw new Error('INKBOX_EMAIL_ADDRESS and the user email are required for Inkbox email delivery.');
  }

  const response = await fetch(
    `${INKBOX_API_BASE}/mail/mailboxes/${encodeURIComponent(mailbox)}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': inkboxApiKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipients: { to: [user.email] },
        subject: "Today's required action",
        body_text: body,
      }),
    },
  );

  if (!response.ok) throw new Error(`Inkbox email failed (${await responseError(response)})`);
}

async function sendInkboxSms(user: User, body: string): Promise<void> {
  const phoneNumberId = process.env.INKBOX_PHONE_NUMBER_ID?.trim();
  if (!phoneNumberId || !user.phone) {
    throw new Error('INKBOX_PHONE_NUMBER_ID and the user phone are required for Inkbox SMS delivery.');
  }

  const response = await fetch(
    `${INKBOX_API_BASE}/phone/numbers/${encodeURIComponent(phoneNumberId)}/texts`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': inkboxApiKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: user.phone, text: body.slice(0, 1600) }),
    },
  );

  if (!response.ok) throw new Error(`Inkbox SMS failed (${await responseError(response)})`);
}

async function sendThroughInkbox(user: User, body: string): Promise<void> {
  const deliveries: Promise<void>[] = [];
  if (user.email) deliveries.push(sendInkboxEmail(user, body));
  if (user.phone && process.env.INKBOX_PHONE_NUMBER_ID?.trim()) deliveries.push(sendInkboxSms(user, body));
  if (deliveries.length === 0) {
    throw new Error('No usable Inkbox delivery destination is configured. Add a user email, or add both a user phone and INKBOX_PHONE_NUMBER_ID.');
  }

  const results = await Promise.allSettled(deliveries);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  if (failures.length > 0) throw new Error(failures.join(' | '));
}

async function sendSms(user: User, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from || !user.phone) {
    throw new Error('Twilio variables and user phone are required for SMS delivery.');
  }
  const params = new URLSearchParams({ To: user.phone, From: from, Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  if (!response.ok) throw new Error(`Twilio failed: ${response.status} ${await response.text()}`);
}

async function sendEmail(user: User, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !user.email) {
    throw new Error('RESEND_API_KEY, RESEND_FROM_EMAIL, and user email are required.');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [user.email], subject: "Today's required action", text: body }),
  });
  if (!response.ok) throw new Error(`Resend failed: ${response.status} ${await response.text()}`);
}

export async function notify(user: User, directive: Directive): Promise<void> {
  const message = directiveMessage(directive);
  switch (user.notificationChannel) {
    case 'maritime':
      if (process.env.NTFY_TOPIC?.trim()) await sendNtfy(message);
      else await sendThroughInkbox(user, message);
      break;
    case 'sms':
      await sendSms(user, message);
      break;
    case 'email':
      await sendEmail(user, message);
      break;
    default:
      console.log(`\n--- Directive for ${user.name} ---\n${message}\n--- end ---\n`);
  }
}
