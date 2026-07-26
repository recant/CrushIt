import type { Directive, User } from './types.js';
import { deliverThroughMaritime } from './maritime.js';
import { money } from './util.js';

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
      if (!user.maritimeAgentId) throw new Error('User has no Maritime agent id.');
      await deliverThroughMaritime(user, user.maritimeAgentId, message);
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
