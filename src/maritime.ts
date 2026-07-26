import { Maritime } from 'maritime-sdk';
import type { Goal, User } from './types.js';
import { safeAgentName } from './util.js';

let client: Maritime | undefined;

function hasMaritimeKey(): boolean {
  const key = process.env.MARITIME_API_KEY;
  return Boolean(key && !key.startsWith('mk_replace'));
}

function demoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

function getClient(): Maritime {
  const apiKey = process.env.MARITIME_API_KEY;
  if (!apiKey || apiKey.startsWith('mk_replace')) {
    throw new Error('MARITIME_API_KEY is missing. Copy .env.example to .env and add a Maritime API key.');
  }
  client ??= new Maritime({ apiKey });
  return client;
}

const BASE_INSTRUCTIONS = `
You are Goal Governor, an autonomous execution agent for one person.
The user states outcomes, not tasks. You own decomposition, opportunity discovery, scheduling recommendations, and daily replanning.
Use connected Google Calendar, Gmail, browser, and other approved tools when available. Infer routine facts instead of asking questions.
Choose exactly one highest-leverage action for today. Make it concrete, time-bounded, feasible, and externally verifiable.
Do not create medical, illegal, humiliating, dangerous, sleep-depriving, or financially reckless assignments.
Never invent financial penalties. The application supplies an authorized penalty amount separately.
When asked for JSON, return only valid JSON with no markdown.
`;

export async function ensureAgent(user: User): Promise<{ id: string; name: string }> {
  const name = user.maritimeAgentName ?? safeAgentName(user.id);
  if (!hasMaritimeKey() && demoMode()) return { id: `demo-${user.id}`, name };
  const maritime = getClient();
  const agent = await maritime.agents.provision({
    externalId: `goal_governor_${user.id}`,
    name,
    template: 'openclaw_identity',
    instructions: `${BASE_INSTRUCTIONS}\nUser name: ${user.name}\nUser phone: ${user.phone ?? 'not supplied'}\nUser email: ${user.email ?? 'not supplied'}\nTimezone: ${user.timezone}\nBoundaries: ${user.boundaries.join('; ') || 'none supplied'}`,
    idleTtlSeconds: 900,
  });
  return { id: agent.id, name };
}

export interface PlannedDirective {
  goalId: string;
  title: string;
  instruction: string;
  whyThis: string;
  deadline: string;
  evidenceRule: {
    type: 'manual' | 'strava_distance_km' | 'github_commit' | 'url' | 'calendar_attendance';
    description: string;
    minValue?: number;
  };
  estimatedProgressPoints: number;
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const first = withoutFence.indexOf('{');
  const last = withoutFence.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error(`Agent did not return JSON: ${raw.slice(0, 300)}`);
  return JSON.parse(withoutFence.slice(first, last + 1));
}

export async function planToday(user: User, goals: Goal[]): Promise<PlannedDirective> {
  if (goals.length === 0) throw new Error('User has no active goals.');
  if (!hasMaritimeKey() && demoMode()) {
    const goal = goals[0]!;
    return {
      goalId: goal.id,
      title: 'Complete the highest-leverage 60-minute block',
      instruction: `Spend one uninterrupted hour producing a concrete artifact that directly advances: ${goal.outcome}. Put the artifact at a shareable URL or submit a written completion note.`,
      whyThis: 'Demo mode cannot inspect your connected calendar or external opportunities, so it chooses a bounded output-producing action.',
      deadline: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
      evidenceRule: { type: 'manual', description: 'A completion note naming the artifact produced.' },
      estimatedProgressPoints: 3,
    };
  }
  const maritime = getClient();
  const agent = await ensureAgent(user);
  const now = new Date();
  const prompt = `
Today is ${now.toISOString()}. Build today's single mandatory action.

USER
${JSON.stringify({
  name: user.name,
  timezone: user.timezone,
  boundaries: user.boundaries,
  weeklyBudgetCents: user.weeklyBudgetCents,
}, null, 2)}

ACTIVE GOALS
${JSON.stringify(goals.map((g) => ({
  id: g.id,
  outcome: g.outcome,
  targetDate: g.targetDate,
  progressPercent: g.progressPercent,
})), null, 2)}

First inspect connected calendar/email and browse for time-sensitive opportunities when relevant. Do not ask the user to plan.
Return exactly one JSON object matching:
{
  "goalId": "an exact goal id above",
  "title": "short action title",
  "instruction": "specific imperative with time/place/deliverable",
  "whyThis": "why this is the highest-leverage action today",
  "deadline": "ISO-8601 timestamp with timezone",
  "evidenceRule": {
    "type": "manual|strava_distance_km|github_commit|url|calendar_attendance",
    "description": "objective evidence required",
    "minValue": 0
  },
  "estimatedProgressPoints": 1
}
The deadline must be in the future, normally within 36 hours. estimatedProgressPoints must be 1-15.
`;

  const { response, error } = await maritime.agents.chat(agent.id, prompt, {
    conversationId: `daily-planning-${user.id}`,
  });
  if (error) throw new Error(error);
  const parsed = extractJson(response ?? '') as PlannedDirective;
  return parsed;
}

export async function deliverThroughMaritime(user: User, agentId: string, message: string): Promise<void> {
  const maritime = getClient();
  const prompt = `Send the following message unchanged to this user using your own Maritime Identity tools. Prefer SMS to ${user.phone ?? 'no phone supplied'}; otherwise email ${user.email ?? 'no email supplied'}; otherwise use a connected WhatsApp or Telegram channel. Do not ask a question and do not add commentary. If no channel is available, report that clearly.\n\n${message}`;
  const { error } = await maritime.agents.chat(agentId, prompt, {
    conversationId: `delivery-${user.id}`,
  });
  if (error) throw new Error(error);
}
