import { runAudit, inspectRepository, inspectSite } from './audit.js';
import { loadConfig, readJson, resolveSession } from './store.js';
import path from 'node:path';

export const toolCatalog = [
  { name: 'inspect-repo', mutates: false, evidenceLevel: 'deterministic-verification', purpose: 'Inspect extractable evidence in local website source files.' },
  { name: 'inspect-site', mutates: false, evidenceLevel: 'deterministic-verification', purpose: 'Fetch the deployed page and robots.txt as a neutral crawler.' },
  { name: 'audit', mutates: false, evidenceLevel: 'deterministic-verification', purpose: 'Combine local and deployed checks into an evidence ledger.' },
  { name: 'evidence', mutates: false, evidenceLevel: 'mixed', purpose: 'Read the evidence artifacts for an agent session.' }
];

export async function executeTool(cwd, name, positional, flags) {
  const config = await loadConfig(cwd);
  if (name === 'inspect-repo') return inspectRepository(config.repoRoot);
  if (name === 'inspect-site') return inspectSite(config.site);
  if (name === 'audit') return runAudit(config, { remote: !flags.offline });
  if (name === 'evidence') {
    const session = await resolveSession(cwd, positional[0]);
    const result = { session: await readJson(path.join(session, 'session.json')) };
    for (const file of ['audit-before.json', 'baseline.json', 'audit-after.json', 'audit-verified.json', 'observer-verification.json']) {
      try { result[file.replace('.json', '')] = await readJson(path.join(session, file)); } catch { /* Artifact is optional. */ }
    }
    return result;
  }
  throw new Error(`unknown tool '${name}'`);
}
