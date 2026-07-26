import type { Directive, User } from './types.js';
import { readStore, updateStore } from './store.js';
import { ensureAgent, planToday } from './maritime.js';
import { notify } from './notifier.js';
import { completeDirective, evidenceSatisfies, failDirective } from './enforcement.js';
import { id } from './util.js';

export async function runMorning(userId: string): Promise<Directive> {
  const store = await readStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) throw new Error('User not found.');
  const activeExisting = store.directives.find((d) => d.userId === userId && d.status === 'active');
  if (activeExisting) return activeExisting;
  const goals = store.goals.filter((g) => g.userId === userId && g.status === 'active');
  const agent = await ensureAgent(user);
  const currentUser: User = { ...user, maritimeAgentId: agent.id, maritimeAgentName: agent.name };
  const plan = await planToday(currentUser, goals);
  const goal = goals.find((g) => g.id === plan.goalId) ?? goals[0];
  if (!goal) throw new Error('No active goal found.');
  const deadline = new Date(plan.deadline);
  if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) {
    deadline.setTime(Date.now() + 12 * 60 * 60 * 1000);
  }
  const directive: Directive = {
    id: id('directive'),
    userId,
    goalId: goal.id,
    title: plan.title.slice(0, 100),
    instruction: plan.instruction,
    whyThis: plan.whyThis,
    deadline: deadline.toISOString(),
    evidenceRule: plan.evidenceRule,
    estimatedProgressPoints: Math.max(1, Math.min(15, Math.round(plan.estimatedProgressPoints || 1))),
    penaltyCents: Math.min(user.penaltyPerFailureCents, user.weeklyPenaltyCapCents),
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  await updateStore((mutable) => {
    const u = mutable.users.find((item) => item.id === userId);
    if (u) {
      u.maritimeAgentId = agent.id;
      u.maritimeAgentName = agent.name;
    }
    mutable.directives.push(directive);
  });
  await notify({ ...currentUser, maritimeAgentId: agent.id }, directive);
  return directive;
}

export async function evaluateDirective(directiveId: string): Promise<'completed' | 'failed' | 'active'> {
  const store = await readStore();
  const directive = store.directives.find((item) => item.id === directiveId);
  if (!directive) throw new Error('Directive not found.');
  if (directive.status !== 'active') return directive.status === 'completed' ? 'completed' : 'failed';
  const evidence = store.evidence.filter((item) => item.directiveId === directiveId);
  if (evidence.some((item) => evidenceSatisfies(directive, item))) {
    await completeDirective(directiveId);
    return 'completed';
  }
  if (new Date(directive.deadline) <= new Date()) {
    await failDirective(directiveId);
    return 'failed';
  }
  return 'active';
}
