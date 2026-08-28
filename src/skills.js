import { homedir } from 'node:os';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

function parseSkill(content, file) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const name = match[1].match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
  const description = match[1].match(/^description:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
  if (!name || !description) return null;
  return { name, description, instructions: match[2].trim(), file };
}

async function skillsIn(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(directory, entry.name, 'SKILL.md');
    try {
      const parsed = parseSkill(await readFile(file, 'utf8'), file);
      if (parsed) skills.push(parsed);
    } catch { /* Ignore malformed or missing optional skills. */ }
  }
  return skills;
}

export async function discoverSkills(cwd) {
  const directories = [path.join(homedir(), '.aeokit', 'skills'), path.join(cwd, '.aeokit', 'skills')];
  const merged = new Map();
  for (const directory of directories) {
    for (const skill of await skillsIn(directory)) merged.set(skill.name, skill);
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function skillInstructions(cwd, name = 'aeo-improve') {
  return (await discoverSkills(cwd)).find((skill) => skill.name === name)?.instructions || '';
}
