import { evaluateDirective, runMorning } from './core.js';
import { readStore, updateStore } from './store.js';
import { localDateTimeParts } from './util.js';

let started = false;

async function morningTick(): Promise<void> {
  const store = await readStore();
  for (const user of store.users) {
    const local = localDateTimeParts(user.timezone);
    if (local.time !== user.morningTime || user.lastMorningRunLocalDate === local.date) continue;
    try {
      await runMorning(user.id);
      await updateStore((mutable) => {
        const u = mutable.users.find((item) => item.id === user.id);
        if (u) u.lastMorningRunLocalDate = local.date;
      });
    } catch (error) {
      console.error('Morning run failed for', user.id, error);
    }
  }
}

async function deadlineTick(): Promise<void> {
  const store = await readStore();
  for (const directive of store.directives.filter((d) => d.status === 'active')) {
    try {
      await evaluateDirective(directive.id);
    } catch (error) {
      console.error('Deadline evaluation failed for', directive.id, error);
    }
  }
}

export function startScheduler(): void {
  if (started) return;
  started = true;
  const morningMs = Math.max(10, Number(process.env.MORNING_POLL_SECONDS ?? 30)) * 1000;
  const deadlineMs = Math.max(10, Number(process.env.DEADLINE_POLL_SECONDS ?? 30)) * 1000;
  setInterval(() => void morningTick(), morningMs).unref();
  setInterval(() => void deadlineTick(), deadlineMs).unref();
  void morningTick();
  void deadlineTick();
}
