import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StoreShape } from './types.js';

const STORE_PATH = path.resolve(process.cwd(), 'data', 'store.json');
const EMPTY_STORE: StoreShape = {
  users: [],
  goals: [],
  directives: [],
  evidence: [],
  penalties: [],
};

let writeQueue: Promise<void> = Promise.resolve();

async function ensureStore(): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.writeFile(STORE_PATH, JSON.stringify(EMPTY_STORE, null, 2), 'utf8');
  }
}

export async function readStore(): Promise<StoreShape> {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, 'utf8');
  return JSON.parse(raw) as StoreShape;
}

export async function updateStore(mutator: (store: StoreShape) => void): Promise<StoreShape> {
  let result: StoreShape = EMPTY_STORE;
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    mutator(store);
    const temp = `${STORE_PATH}.tmp`;
    await fs.writeFile(temp, JSON.stringify(store, null, 2), 'utf8');
    await fs.rename(temp, STORE_PATH);
    result = store;
  });
  await writeQueue;
  return result;
}
