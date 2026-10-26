import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Session snapshots on disk, so a server restart does not lose the party.
const FILE = process.env.DJ_DATA_FILE ?? fileURLToPath(new URL('../data/sessions.json', import.meta.url));

export function readSnapshots<T>(): T[] {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as T[];
  } catch {
    return [];
  }
}

// Synchronous on purpose: writes are rare (wishes, votes, next track) and the file stays small,
// so there is no pending write to lose when the process gets killed.
export function writeSnapshots(snapshots: unknown[]): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(`${FILE}.tmp`, JSON.stringify(snapshots));
    renameSync(`${FILE}.tmp`, FILE);
  } catch (e) {
    console.warn(`could not save sessions to ${FILE}:`, e);
  }
}
