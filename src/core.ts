import type { Directive, User } from './types.js';
import { readStore, updateStore } from './store.js';
import { ensureAgent, planToday } from './maritime.js';
import { notify } from './notifier.js';
import { completeDirective, evidenceSatisfies, failDirective } from './enforcement.js';
import { id } from './util.js';

async function deliverDirective(user: User, directive: Directive): Promise<Directive> {
  try {
    await notify(user, directive);
    const deliveredAt = new Date().toISOString();
    await updateStore((store) => {
      const stored = store.directives.find((item) => item.id === directive.id);
      if (stored) {
        stored.deliveryStatus = 'sent';
        stored.deliveryError = undefined;
        stored.deliveredAt = deliveredAt;
      }
    });
    return { ...directive, deliveryStatus: 'sent', deliveryError: undefined, deliveredAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown delivery error';
    console.warn('Directive delivery failed for', directive.id, message);
    await updateStore((store) => {
      const stored = store.directives.find((item) => item.id === directive.id);
      if (stored) {
        stored.deliveryStatus = 'failed';
        stored.deliveryError = message;
      }
    });
    return { ...directive, deliveryStatus: 'failed', deliveryError: message };
  }
}

export async function runMorning(userId: string): Promise<Directive> {
  const store = await readStore();
  const user = store.users.find((item) => item.id === userId);
  if (!user) throw new Error('User not found.');

  const activeExisting = store.directives.find((directive) => directive.userId === userId && directive.status === 'active');
  if (activeExisting) {
    if (activeExisting.deliveryStatus === 'sent') return activeExisting;
    const agent = await ensureAgent(user);
    const currentUser: User = { ...user, maritimeAgentId: agent.id, maritimeAgentName: agent.name };
    await updateStore((mutable) => {
      const storedUser = mutable.users.find((item) => item.id === userId);
      if (storedUser) {
        storedUser.maritimeAgentId = agent.id;
        storedUser.maritimeAgentName = agent.name;
      }
    });
    return deliverDirective(currentUser, activeExisting);
  }

  const goals = store.goals.filter((goal) => goal.userId === userId && goal.status === 'active');
  const agent = await ensureAgent(user);
  const currentUser: User = { ...user, maritimeAgentId: agent.id, maritimeAgentName: agent.name };
  const plan = await planToday(currentUser, goals);
  const goal = goals.find((item) => item.id === plan.goalId) ?? goals[0];
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
    deliveryStatus: 'pending',
    createdAt: new Date().toISOString(),
  };

  await updateStore((mutable) => {
    const storedUser = mutable.users.find((item) => item.id === userId);
    if (storedUser) {
      storedUser.maritimeAgentId = agent.id;
      storedUser.maritimeAgentName = agent.name;
    }
    mutable.directives.push(directive);
  });

  return deliverDirective(currentUser, directive);
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
