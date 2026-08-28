import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverSkills, skillInstructions } from '../src/skills.js';

test('discovers project-installed AEOkit skills', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aeokit-skills-'));
  const directory = path.join(root, '.aeokit', 'skills', 'aeo-improve');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'SKILL.md'), `---\nname: aeo-improve\ndescription: Improve a site for AEO.\n---\n\nUse evidence.\n`);
  const skills = await discoverSkills(root);
  assert.ok(skills.some((skill) => skill.name === 'aeo-improve'));
  assert.equal(await skillInstructions(root), 'Use evidence.');
});
