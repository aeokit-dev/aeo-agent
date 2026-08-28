import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const stateDir = (cwd) => path.join(cwd, '.aeokit');
export const sessionsDir = (cwd) => path.join(stateDir(cwd), 'sessions');

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

export async function writeText(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, value.endsWith('\n') ? value : `${value}\n`);
  await rename(temporary, file);
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function loadConfig(cwd) {
  try {
    return await readJson(path.join(stateDir(cwd), 'config.json'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`not initialized; run 'aeokit-agent init <url>' first`);
    throw error;
  }
}

export function createSessionId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function resolveSession(cwd, requested = 'latest') {
  const root = sessionsDir(cwd);
  if (requested && requested !== 'latest') return path.join(root, requested);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('no agent sessions found');
    throw error;
  }
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  if (!names.length) throw new Error('no agent sessions found');
  return path.join(root, names[0]);
}
