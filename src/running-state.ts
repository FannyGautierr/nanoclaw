/**
 * Lightweight on-disk state for currently executing containers.
 * Written at container start, cleared on completion.
 * Read by the dashboard process (separate Node process, no shared memory).
 *
 * File: data/state/running.json
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';

const STATE_DIR = path.join(DATA_DIR, 'state');
const STATE_FILE = path.join(STATE_DIR, 'running.json');

export interface RunningEntry {
  id: string; // taskId for scheduled tasks, groupJid for message runs
  type: 'task' | 'message';
  taskId?: string;
  prompt: string;
  groupFolder: string;
  chatJid: string;
  startedAt: string;
  scheduleType?: string;
}

function readState(): RunningEntry[] {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeState(entries: RunningEntry[]): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(entries, null, 2));
  } catch {
    // Non-fatal — dashboard degrades gracefully if file is missing
  }
}

export function markStarted(entry: RunningEntry): void {
  const entries = readState().filter((e) => e.id !== entry.id);
  entries.push(entry);
  writeState(entries);
}

export function markEnded(id: string): void {
  const entries = readState().filter((e) => e.id !== id);
  writeState(entries);
}

export function getRunning(): RunningEntry[] {
  return readState();
}
