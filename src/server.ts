import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { readStore, updateStore } from './store.js';
import { id } from './util.js';
import { runMorning, evaluateDirective } from './core.js';
import { startScheduler } from './scheduler.js';
import { addCorrectionToAgent } from './maritime.js';
import type { Evidence, Goal, User } from './types.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve(process.cwd(), 'public')));

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  timezone: z.string().min(1).default('America/New_York'),
  morningTime: z.string().regex(/^\d{2}:\d{2}$/).default('07:00'),
  notificationChannel: z.enum(['maritime', 'sms', 'email', 'console']).default('maritime'),
  boundaries: z.array(z.string()).default([]),
  weeklyBudgetDollars: z.number().min(0).max(10000).default(0),
  penaltyPerFailureDollars: z.number().min(0).max(1000).default(5),
  weeklyPenaltyCapDollars: z.number().min(0).max(5000).default(20),
  stakeBalanceDollars: z.number().min(0).max(100000).default(50),
}).refine((value) => Boolean(value.phone || value.email), {
  message: 'A phone number or email address is required.',
});

const goalSchema = z.object({
  userId: z.string().min(1),
  outcome: z.string().min(3),
  targetDate: z.string().optional(),
});

const evidenceSchema = z.object({
  source: z.string().min(1),
  note: z.string().optional(),
  numericValue: z.number().optional(),
  url: z.string().url().optional().or(z.literal('')),
  accepted: z.boolean().default(true),
});

const correctionSchema = z.object({ text: z.string().min(1).max(2000) });

function asyncRoute(
  fn: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res, next) => void fn(req, res).catch(next);
}

function requireRouteParam(value: string | string[] | undefined, name: string): string {
  const resolved = Array.isArray(value) ? value[0] : value;
  if (!resolved) throw new Error(`Missing route parameter: ${name}`);
  return resolved;
}

app.get('/api/state', asyncRoute(async (_req, res) => {
  res.json(await readStore());
}));

app.post('/api/users', asyncRoute(async (req, res) => {
  const input = userSchema.parse(req.body);
  const user: User = {
    id: id('user'),
    name: input.name,
    email: input.email || undefined,
    phone: input.phone || undefined,
    timezone: input.timezone,
    morningTime: input.morningTime,
    notificationChannel: input.notificationChannel,
    boundaries: input.boundaries.filter(Boolean),
    weeklyBudgetCents: Math.round(input.weeklyBudgetDollars * 100),
    penaltyPerFailureCents: Math.round(input.penaltyPerFailureDollars * 100),
    weeklyPenaltyCapCents: Math.round(input.weeklyPenaltyCapDollars * 100),
    stakeBalanceCents: Math.round(input.stakeBalanceDollars * 100),
    createdAt: new Date().toISOString(),
  };
  await updateStore((store) => store.users.push(user));
  res.status(201).json(user);
}));

app.post('/api/goals', asyncRoute(async (req, res) => {
  const input = goalSchema.parse(req.body);
  const store = await readStore();
  if (!store.users.some((u) => u.id === input.userId)) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const goal: Goal = {
    id: id('goal'),
    userId: input.userId,
    outcome: input.outcome,
    targetDate: input.targetDate || undefined,
    status: 'active',
    progressPercent: 0,
    createdAt: new Date().toISOString(),
  };
  await updateStore((mutable) => mutable.goals.push(goal));
  res.status(201).json(goal);
}));

app.post('/api/run/morning/:userId', asyncRoute(async (req, res) => {
  const userId = requireRouteParam(req.params.userId, 'userId');
  const directive = await runMorning(userId);
  res.json(directive);
}));

app.post('/api/users/:userId/corrections', asyncRoute(async (req, res) => {
  const userId = requireRouteParam(req.params.userId, 'userId');
  const { text } = correctionSchema.parse(req.body);
  const store = await readStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  await addCorrectionToAgent(user, text);
  await updateStore((mutable) => {
    const target = mutable.users.find((item) => item.id === userId);
    if (target) target.boundaries.push(`User correction: ${text}`);
  });
  res.json({ ok: true });
}));

app.post('/api/directives/:directiveId/evidence', asyncRoute(async (req, res) => {
  const directiveId = requireRouteParam(req.params.directiveId, 'directiveId');
  const input = evidenceSchema.parse(req.body);
  const store = await readStore();
  if (!store.directives.some((d) => d.id === directiveId)) {
    res.status(404).json({ error: 'Directive not found' });
    return;
  }
  const evidence: Evidence = {
    id: id('evidence'),
    directiveId,
    source: input.source,
    note: input.note,
    numericValue: input.numericValue,
    url: input.url || undefined,
    accepted: input.accepted,
    createdAt: new Date().toISOString(),
  };
  await updateStore((mutable) => mutable.evidence.push(evidence));
  const status = await evaluateDirective(directiveId);
  res.status(201).json({ evidence, status });
}));

app.post('/api/directives/:directiveId/evaluate', asyncRoute(async (req, res) => {
  const directiveId = requireRouteParam(req.params.directiveId, 'directiveId');
  res.json({ status: await evaluateDirective(directiveId) });
}));

app.post('/api/directives/:directiveId/force-deadline', asyncRoute(async (req, res) => {
  const directiveId = requireRouteParam(req.params.directiveId, 'directiveId');
  await updateStore((store) => {
    const directive = store.directives.find((d) => d.id === directiveId);
    if (directive && directive.status === 'active') directive.deadline = new Date(Date.now() - 1000).toISOString();
  });
  res.json({ status: await evaluateDirective(directiveId) });
}));

app.post('/api/webhooks/evidence/:directiveId', asyncRoute(async (req, res) => {
  const directiveId = requireRouteParam(req.params.directiveId, 'directiveId');
  const secret = req.header('x-goal-governor-secret');
  if (!process.env.APP_WEBHOOK_SECRET || secret !== process.env.APP_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Bad webhook secret' });
    return;
  }
  const input = evidenceSchema.parse(req.body);
  const evidence: Evidence = {
    id: id('evidence'),
    directiveId,
    source: input.source,
    note: input.note,
    numericValue: input.numericValue,
    url: input.url || undefined,
    accepted: input.accepted,
    createdAt: new Date().toISOString(),
  };
  await updateStore((store) => store.evidence.push(evidence));
  res.json({ ok: true, status: await evaluateDirective(directiveId) });
}));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Invalid input', details: error.flatten() });
    return;
  }
  res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
});

startScheduler();
app.listen(port, () => console.log(`Goal Governor running at http://localhost:${port}`));
