export type NotificationChannel = 'maritime' | 'sms' | 'email' | 'console';
export type DirectiveStatus = 'active' | 'completed' | 'failed' | 'appealed';

export interface User {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  timezone: string;
  morningTime: string;
  notificationChannel: NotificationChannel;
  boundaries: string[];
  weeklyBudgetCents: number;
  penaltyPerFailureCents: number;
  weeklyPenaltyCapCents: number;
  stakeBalanceCents: number;
  maritimeAgentId?: string;
  maritimeAgentName?: string;
  lastMorningRunLocalDate?: string;
  createdAt: string;
}

export interface Goal {
  id: string;
  userId: string;
  outcome: string;
  targetDate?: string;
  status: 'active' | 'paused' | 'completed';
  progressPercent: number;
  createdAt: string;
}

export interface EvidenceRule {
  type: 'manual' | 'strava_distance_km' | 'github_commit' | 'url' | 'calendar_attendance';
  description: string;
  minValue?: number;
}

export interface Directive {
  id: string;
  userId: string;
  goalId: string;
  title: string;
  instruction: string;
  whyThis: string;
  deadline: string;
  evidenceRule: EvidenceRule;
  estimatedProgressPoints: number;
  penaltyCents: number;
  status: DirectiveStatus;
  createdAt: string;
  completedAt?: string;
  failedAt?: string;
}

export interface Evidence {
  id: string;
  directiveId: string;
  source: string;
  note?: string;
  numericValue?: number;
  url?: string;
  accepted: boolean;
  createdAt: string;
}

export interface Penalty {
  id: string;
  userId: string;
  directiveId: string;
  amountCents: number;
  status: 'deducted' | 'skipped_cap' | 'reversed';
  reason: string;
  createdAt: string;
}

export interface StoreShape {
  users: User[];
  goals: Goal[];
  directives: Directive[];
  evidence: Evidence[];
  penalties: Penalty[];
}
