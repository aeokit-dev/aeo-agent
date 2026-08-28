import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPlan } from '../src/harness.js';
import { writeJson } from '../src/store.js';

test('creates an auditable plan session with fixture agents', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aeokit-harness-'));
  await writeJson(path.join(root, '.aeokit', 'config.json'), {
    schemaVersion: 1,
    brand: 'Acme',
    site: 'https://example.com',
    category: 'testing tools',
    audience: 'developers',
    useCase: 'testing software',
    competitors: [],
    aliases: [],
    repoRoot: root
  });
  const result = await createPlan(root, { query: 'Which testing tools should developers use?', provider: 'fixture', observer: 'fixture', remote: false });
  assert.equal(result.session.status, 'planned');
  assert.equal(result.observation.observations.length, 1);
  assert.match(await readFile(path.join(result.sessionDir, 'proposal.md'), 'utf8'), /Proposed AEO change/);
});
