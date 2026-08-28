import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execute } from './process.js';
import { readJson, writeJson } from './store.js';

const require = createRequire(import.meta.url);

export function previewBin() {
  const packageFile = require.resolve('aeo-preview/package.json');
  return path.join(path.dirname(packageFile), 'bin', 'aeo.js');
}

function bundledFixture() {
  const packageFile = require.resolve('aeo-preview/package.json');
  return path.join(path.dirname(packageFile), 'fixtures', 'demo-answers.json');
}

export async function runPreview(config, { query, provider, samples = 1, workspace, fixture, timeout = 180_000, onActivity } = {}) {
  const state = path.join(workspace, '.aeo');
  await mkdir(path.join(state, 'runs'), { recursive: true });
  const domain = new URL(config.site.includes('://') ? config.site : `https://${config.site}`).hostname;
  const previewConfig = {
    schemaVersion: 1,
    brand: config.brand,
    domain,
    category: config.category,
    audience: config.audience,
    useCase: config.useCase,
    competitors: config.competitors || [],
    aliases: config.aliases || [],
    createdAt: new Date().toISOString()
  };
  const prompts = [{ id: 'P001', archetype: 'user-objective', intent: 'discovery', text: query, weight: 1 }];
  await writeJson(path.join(state, 'config.json'), previewConfig);
  await writeJson(path.join(state, 'prompts.json'), prompts);
  const args = [previewBin(), 'run', '--provider', provider, '--samples', String(samples), '--timeout', String(timeout), '--json'];
  if (fixture) args.push('--fixture', path.resolve(fixture));
  else if (provider === 'fixture') args.push('--fixture', bundledFixture());
  const result = await execute(process.execPath, args, { cwd: workspace, timeout: timeout * Math.max(1, samples) + 30_000, onLine: (line, stream) => {
    if (stream === 'stderr') onActivity?.(line);
  } });
  let run;
  try {
    run = JSON.parse(result.stdout);
  } catch {
    throw new Error('AEO Preview returned invalid JSON evidence');
  }
  return run;
}

export async function latestPreviewRun(workspace) {
  const runs = await import('node:fs/promises').then(({ readdir }) => readdir(path.join(workspace, '.aeo', 'runs')));
  const latest = runs.filter((name) => name.endsWith('.json')).sort().reverse()[0];
  return latest ? readJson(path.join(workspace, '.aeo', 'runs', latest)) : null;
}
