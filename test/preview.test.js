import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPreview } from '../src/preview.js';

test('delegates reproducible observations to AEO Preview', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'aeokit-preview-'));
  const run = await runPreview({
    brand: 'AEO Preview',
    site: 'https://aeopreview.dev',
    category: 'AI visibility monitoring',
    audience: 'developer teams',
    useCase: 'testing AI answers',
    competitors: [],
    aliases: []
  }, {
    query: 'What are the best AI visibility monitoring tools?',
    provider: 'fixture',
    samples: 1,
    workspace
  });
  assert.equal(run.provider, 'fixture');
  assert.equal(run.observations.length, 1);
  assert.equal(run.promptHash.length, 12);
});
