import type { Directive, Evidence, Penalty, User } from './types.js';
import { readStore, updateStore } from './store.js';
import { id, startOfWeekUtc } from './util.js';

export function evidenceSatisfies(directive: Directive, evidence: Evidence): boolean {
  if (!evidence.accepted) return false;
  const rule = directive.evidenceRule;
  if (rule.type === 'manual') return true;
  if (rule.type === 'url') return Boolean(evidence.url);
  if (rule.type === 'github_commit') return evidence.source === 'github_commit' && Boolean(evidence.url || evidence.note);
  if (rule.type === 'calendar_attendance') return evidence.source === 'calendar_attendance';
  if (rule.type === 'strava_distance_km') {
    return evidence.source === 'strava_distance_km' &&
      typeof evidence.numericValue === 'number' &&
      evidence.numericValue >= (rule.minValue ?? 0);
  }
  return false;
}

export async function completeDirective(directiveId: string): Promise<void> {
  await updateStore((store) => {
    const directive = store.directives.find((item) => item.id === directiveId);
    if (!directive || directive.status !== 'active') return;
    directive.status = 'completed';
    directive.completedAt = new Date().toISOString();
    const goal = store.goals.find((item) => item.id === directive.goalId);
    if (goal) goal.progressPercent = Math.min(100, goal.progressPercent + directive.estimatedProgressPoints);
  });
}

export async function failDirective(directiveId: string): Promise<Penalty | undefined> {
  const store = await readStore();
  const directive = store.directives.find((item) => item.id === directiveId);
  if (!directive || directive.status !== 'active') return undefined;
  const user = store.users.find((item) => item.id === directive.userId);
  if (!user) throw new Error('Directive user missing.');

  const weekStart = startOfWeekUtc();
  const chargedThisWeek = store.penalties
    .filter((p) => p.userId === user.id && p.status === 'deducted' && new Date(p.createdAt) >= weekStart)
    .reduce((sum, p) => sum + p.amountCents, 0);
  const allowedByCap = Math.max(0, user.weeklyPenaltyCapCents - chargedThisWeek);
  const amount = Math.min(directive.penaltyCents, allowedByCap, user.stakeBalanceCents);
  const penalty: Penalty = {
    id: id('penalty'),
    userId: user.id,
    directiveId,
    amountCents: amount,
    status: amount > 0 ? 'deducted' : 'skipped_cap',
    reason: amount > 0 ? 'Missed verified directive' : 'Weekly cap or stake balance prevented deduction',
    createdAt: new Date().toISOString(),
  };

  await updateStore((mutable) => {
    const d = mutable.directives.find((item) => item.id === directiveId);
    const u = mutable.users.find((item) => item.id === user.id);
    if (!d || !u || d.status !== 'active') return;
    d.status = 'failed';
    d.failedAt = new Date().toISOString();
    if (amount > 0) u.stakeBalanceCents -= amount;
    mutable.penalties.push(penalty);
  });
  return penalty;
}
