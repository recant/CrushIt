import crypto from 'node:crypto';

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function safeAgentName(userId: string): string {
  return `goal-governor-${userId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 18)}`.toLowerCase();
}

export function localDateTimeParts(timeZone: string, date = new Date()): {
  date: string;
  time: string;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function startOfWeekUtc(date = new Date()): Date {
  const copy = new Date(date);
  const day = copy.getUTCDay();
  const diff = (day + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - diff);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}
