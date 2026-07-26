import { Maritime } from 'maritime-sdk';
import { z } from 'zod';
import type { Goal, User } from './types.js';
import { safeAgentName } from './util.js';

let client: Maritime | undefined;

const MARITIME_API_BASE = 'https://api.maritime.sh';
const MARITIME_PROVISIONING_BASE = 'https://api.maritime.sh/api/v1';

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hasMaritimeKey(): boolean {
  const key = process.env.MARITIME_API_KEY;
  return Boolean(key && !key.startsWith('mk_replace'));
}

function demoMode(): boolean {
  return process.env.DEMO_MODE === 'true';
}

function maritimeApiKey(): string {
  const apiKey = process.env.MARITIME_API_KEY;
  if (!apiKey || apiKey.startsWith('mk_replace')) {
    throw new Error('MARITIME_API_KEY is missing. Copy .env.example to .env and add a Maritime API key.');
  }
  return apiKey;
}

function getClient(): Maritime {
  client ??= new Maritime({ apiKey: maritimeApiKey() });
  return client;
}

function readyTimeoutMs(): number {
  const configured = Number(process.env.MARITIME_AGENT_READY_TIMEOUT_MS ?? 180_000);
  return Number.isFinite(configured) ? Math.max(30_000, configured) : 180_000;
}

async function responseDetails(response: Response): Promise<string> {
  const text = await response.text();
  return text ? `: ${text.slice(0, 500)}` : '';
}

export async function waitForAgentReady(agentId: string): Promise<void> {
  if (!hasMaritimeKey() && demoMode()) return;

  const deadline = Date.now() + readyTimeoutMs();
  let lastStatus = 'unknown';

  while (Date.now() < deadline) {
    const response = await fetch(`${MARITIME_API_BASE}/api/agents/${encodeURIComponent(agentId)}`, {
      headers: { Authorization: `Bearer ${maritimeApiKey()}` },
    });
    if (!response.ok) {
      throw new Error(`Could not read Maritime agent status (${response.status})${await responseDetails(response)}`);
    }

    const payload = await response.json() as { status?: unknown; error?: unknown; message?: unknown };
    lastStatus = String(payload.status ?? 'unknown').toLowerCase();

    if (['active', 'sleeping', 'ready', 'running'].includes(lastStatus)) return;
    if (['error', 'failed', 'deleted'].includes(lastStatus)) {
      throw new Error(`Maritime agent deployment failed with status ${lastStatus}: ${String(payload.error ?? payload.message ?? 'No deployment detail was returned.')}`);
    }

    await sleep(2_000);
  }

  throw new Error(`Maritime agent did not become ready within ${Math.round(readyTimeoutMs() / 1000)} seconds. Last status: ${lastStatus}.`);
}

interface MaritimeEnvironmentVariable {
  key?: string;
}

async function ensureAgentModelProvider(agentId: string): Promise<void> {
  const apiKey = maritimeApiKey();
  const envResponse = await fetch(`${MARITIME_PROVISIONING_BASE}/agents/${encodeURIComponent(agentId)}/env`, {
    headers: { 'X-API-Key': apiKey },
  });
  if (!envResponse.ok) {
    throw new Error(`Could not inspect the Maritime agent's model configuration (${envResponse.status})${await responseDetails(envResponse)}. The Maritime key needs provision, deploy, and manage scopes.`);
  }

  const variables = await envResponse.json() as MaritimeEnvironmentVariable[];
  if (variables.some((variable) => variable.key === 'OPENAI_API_KEY' || variable.key === 'ANTHROPIC_API_KEY')) return;

  const provider = process.env.OPENAI_API_KEY
    ? { key: 'OPENAI_API_KEY', value: process.env.OPENAI_API_KEY }
    : process.env.ANTHROPIC_API_KEY
      ? { key: 'ANTHROPIC_API_KEY', value: process.env.ANTHROPIC_API_KEY }
      : undefined;

  if (!provider) {
    throw new Error('The OpenClaw Identity agent has no model provider. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to this app\'s .env file. Maritime hosts the agent; OpenClaw still needs a model provider.');
  }

  const setResponse = await fetch(`${MARITIME_PROVISIONING_BASE}/agents/${encodeURIComponent(agentId)}/env`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: provider.key, value: provider.value, is_secret: true }),
  });
  if (!setResponse.ok) {
    throw new Error(`Could not configure ${provider.key} on the Maritime agent (${setResponse.status})${await responseDetails(setResponse)}. The Maritime key needs manage scope.`);
  }

  const restartResponse = await fetch(`${MARITIME_PROVISIONING_BASE}/agents/${encodeURIComponent(agentId)}/restart`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
  });
  if (!restartResponse.ok) {
    throw new Error(`Could not restart the Maritime agent after configuring its model (${restartResponse.status})${await responseDetails(restartResponse)}`);
  }

  await sleep(2_500);
  await waitForAgentReady(agentId);
}

const BASE_INSTRUCTIONS = `
You are Goal Governor, an autonomous execution agent for one person.
The user states outcomes, not tasks. You own decomposition, opportunity discovery, scheduling recommendations, and daily replanning.
Use connected Google Calendar, Gmail, browser, and other approved tools when available. Infer routine facts instead of asking questions.
Choose exactly one highest-leverage action for today. Make it concrete, time-bounded, feasible, and externally verifiable.
Do not create medical, illegal, humiliating, dangerous, sleep-depriving, or financially reckless assignments.
Never invent financial penalties. The application supplies an authorized penalty amount separately.
When asked for JSON, return only valid JSON with no markdown.
When asked to deliver a directive, use your Maritime Identity communication tools. Send the exact supplied content and do not embellish it.
`;

export async function ensureAgent(user: User): Promise<{ id: string; name: string }> {
  const name = user.maritimeAgentName ?? safeAgentName(user.id);
  if (!hasMaritimeKey() && demoMode()) return { id: `demo-${user.id}`, name };

  if (user.maritimeAgentId) {
    await waitForAgentReady(user.maritimeAgentId);
    await ensureAgentModelProvider(user.maritimeAgentId);
    return { id: user.maritimeAgentId, name };
  }

  const maritime = getClient();
  const agent = await maritime.agents.provision({
    externalId: `goal_governor_${user.id}`,
    name,
    template: 'openclaw_identity',
    instructions: `${BASE_INSTRUCTIONS}\nUser name: ${user.name}\nUser phone: ${user.phone ?? 'not supplied'}\nUser email: ${user.email ?? 'not supplied'}\nTimezone: ${user.timezone}\nBoundaries and context: ${user.boundaries.join('; ') || 'none supplied'}`,
    idleTtlSeconds: 900,
  });

  await waitForAgentReady(agent.id);
  await ensureAgentModelProvider(agent.id);
  return { id: agent.id, name };
}

function transientStatusMessage(message: string): boolean {
  return /Agent is AgentStatus\.(deploying|starting|waking|sleeping)/i.test(message)
    || /\b(deploying|starting|waking)\b.*cannot process/i.test(message);
}

async function chatAgent(agentId: string, prompt: string, conversationId: string): Promise<string> {
  const maritime = getClient();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitForAgentReady(agentId);
    const { response, error } = await maritime.agents.chat(agentId, prompt, { conversationId });
    const reply = (response ?? '').trim();
    const failure = (error ?? '').trim();

    if (!failure && reply && !transientStatusMessage(reply)) return reply;
    if (failure && !transientStatusMessage(failure)) throw new Error(failure);

    await sleep(2_500);
  }

  throw new Error('The Maritime agent remained unavailable after deployment completed. Check `maritime status` and `maritime logs` for the agent.');
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
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = withoutFence.indexOf('{');
  const last = withoutFence.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error(`Agent did not return JSON: ${raw.slice(0, 300)}`);
  return JSON.parse(withoutFence.slice(first, last + 1));
}

const onboardingTurnSchema = z.object({
  message: z.string().min(1),
  complete: z.boolean(),
  updates: z.object({
    targetDate: z.string().nullable(),
    currentLevel: z.string().nullable(),
    constraints: z.array(z.string()),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    morningTime: z.string().nullable(),
  }),
});

export type OnboardingTurn = z.infer<typeof onboardingTurnSchema>;
export interface OnboardingTranscriptMessage {
  role: 'user' | 'agent';
  text: string;
}

export async function continueOnboarding(
  user: User,
  goal: Goal,
  latestMessage: string,
  transcript: OnboardingTranscriptMessage[],
): Promise<OnboardingTurn> {
  if (!hasMaritimeKey() && demoMode()) {
    return {
      message: 'What is the most important fact about your current starting point that should change the plan?',
      complete: false,
      updates: { targetDate: null, currentLevel: null, constraints: [], phone: null, email: null, morningTime: null },
    };
  }

  const agent = await ensureAgent(user);
  const startingPoint = user.boundaries.find((item) => item.startsWith('Starting point: '))?.slice('Starting point: '.length) ?? null;
  const constraints = user.boundaries.filter((item) => !item.startsWith('Starting point: ') && !item.startsWith('User correction: '));

  const prompt = `
You are conducting an adaptive onboarding conversation for an autonomous goal-execution product.

The first question was fixed: "What do you want to accomplish?" The user answered it. From now on, you decide what to ask based on what is actually missing. Do not follow a predetermined questionnaire or fixed field order.

Rules:
- Ask at most one concise question at a time.
- Ask only when the answer materially changes the plan, is subjective, or requires permission.
- Infer ordinary details whenever reasonable.
- Never ask the user to design tasks, milestones, strategy, or a weekly plan. That is your job.
- Before activation, understand the outcome well enough to act, the meaningful starting context, hard constraints, at least one delivery destination (phone or email), and the preferred morning delivery time. Default morning time to 07:00 when the user has no preference.
- A target date is optional when the goal does not require one.
- Normalize phone numbers to international E.164 format when possible, dates to YYYY-MM-DD, and morning time to HH:MM.
- Set complete=true only when no additional material question is needed and at least one delivery destination is known.
- The message must be natural conversational text. When complete=true, make it a brief confirmation rather than another question.

KNOWN STATE
${JSON.stringify({
  outcome: goal.outcome,
  targetDate: goal.targetDate ?? null,
  currentLevel: startingPoint,
  constraints,
  phone: user.phone ?? null,
  email: user.email ?? null,
  morningTime: user.morningTime,
  timezone: user.timezone,
}, null, 2)}

RECENT CONVERSATION
${JSON.stringify(transcript.slice(-20), null, 2)}

LATEST USER MESSAGE
${latestMessage}

Return exactly one JSON object:
{
  "message": "the next question or final confirmation",
  "complete": false,
  "updates": {
    "targetDate": null,
    "currentLevel": null,
    "constraints": [],
    "phone": null,
    "email": null,
    "morningTime": null
  }
}
Use null for fields that were not newly learned in this turn. Put only genuinely hard constraints in constraints.
`;

  const response = await chatAgent(agent.id, prompt, `onboarding-${user.id}`);
  return onboardingTurnSchema.parse(extractJson(response));
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
${JSON.stringify(goals.map((goal) => ({
  id: goal.id,
  outcome: goal.outcome,
  targetDate: goal.targetDate,
  progressPercent: goal.progressPercent,
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

  const response = await chatAgent(agent.id, prompt, `daily-planning-${user.id}`);
  return extractJson(response) as PlannedDirective;
}

export async function addCorrectionToAgent(user: User, text: string): Promise<void> {
  if (!user.maritimeAgentId) throw new Error('The Maritime agent has not been provisioned yet.');
  await chatAgent(
    user.maritimeAgentId,
    `Record this user correction as persistent planning context. Do not generate a new directive yet. Correction: ${text}`,
    `user-context-${user.id}`,
  );
}

export async function deliverThroughMaritime(user: User, agentId: string, message: string): Promise<void> {
  const destinations = [
    user.phone ? `SMS to ${user.phone}` : null,
    user.email ? `email to ${user.email}` : null,
  ].filter(Boolean).join(' and ');
  if (!destinations) throw new Error('At least one phone number or email address is required for Maritime delivery.');

  const prompt = `
Use your Maritime Identity communication tools to send the exact directive below to ${destinations}.
If both a phone number and email are supplied, send it through both channels.
Do not ask the user a question. Do not add commentary. Do not merely draft the message: actually send it.
After attempting delivery, return a one-line status beginning with SENT or FAILED.

DIRECTIVE
${message}
`;
  const response = await chatAgent(agentId, prompt, `delivery-${user.id}`);
  if (!/^SENT\b/i.test(response)) {
    throw new Error(`Maritime agent did not confirm delivery: ${response.slice(0, 300)}`);
  }
}
