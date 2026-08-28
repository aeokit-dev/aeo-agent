import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from './audit.js';
import { gitDiff, gitStatus } from './git.js';
import { planPrompt, applyPrompt } from './prompts.js';
import { runBlindObserver, runProvider } from './providers.js';
import { runPreview } from './preview.js';
import { skillInstructions } from './skills.js';
import { createSessionId, loadConfig, readJson, resolveSession, sessionsDir, writeJson, writeText } from './store.js';

function activity(enabled) {
  return enabled ? (message) => process.stderr.write(`  ${message}\n`) : undefined;
}

export function defaultQuery(config) {
  return `What are the best ${config.category} tools for ${config.audience}?`;
}

export async function createPlan(cwd, options = {}) {
  const config = await loadConfig(cwd);
  const id = createSessionId();
  const sessionDir = path.join(sessionsDir(cwd), id);
  await mkdir(sessionDir, { recursive: true });
  const query = options.query || defaultQuery(config);
  const session = {
    schemaVersion: 1,
    id,
    status: 'planning',
    query,
    operatorProvider: options.provider || 'codex',
    observerProvider: options.observer || 'none',
    createdAt: new Date().toISOString()
  };
  await writeJson(path.join(sessionDir, 'session.json'), session);

  options.onStage?.('Auditing repository and deployed site');
  const audit = await runAudit(config, { remote: options.remote !== false });
  await writeJson(path.join(sessionDir, 'audit-before.json'), audit);

  let observation = null;
  if (session.observerProvider !== 'none') {
    options.onStage?.(`Collecting blind baseline with ${session.observerProvider}`);
    observation = await runPreview(config, {
      query,
      provider: session.observerProvider,
      samples: options.samples || 1,
      workspace: path.join(sessionDir, 'baseline'),
      fixture: options.fixture,
      timeout: options.observerTimeout,
      onActivity: activity(options.verbose)
    });
    await writeJson(path.join(sessionDir, 'baseline.json'), observation);
  }

  options.onStage?.(`Asking ${session.operatorProvider} for an evidence-backed plan`);
  const skill = await skillInstructions(cwd, 'aeo-improve');
  const operator = await runProvider(session.operatorProvider, planPrompt({ config, query, audit, observation, skill }), {
    cwd: config.repoRoot,
    mode: 'plan',
    timeout: options.operatorTimeout,
    onActivity: activity(options.verbose)
  });
  await writeText(path.join(sessionDir, 'proposal.md'), operator.answer);
  await writeJson(path.join(sessionDir, 'operator.json'), { provider: operator.provider, usage: operator.usage });
  session.status = 'planned';
  session.completedAt = new Date().toISOString();
  await writeJson(path.join(sessionDir, 'session.json'), session);
  return { id, sessionDir, session, audit, observation, proposal: operator.answer };
}

export async function applyPlan(cwd, requested, options = {}) {
  const config = await loadConfig(cwd);
  const sessionDir = await resolveSession(cwd, requested);
  const session = await readJson(path.join(sessionDir, 'session.json'));
  const proposal = await readFile(path.join(sessionDir, 'proposal.md'), 'utf8');
  const dirty = await gitStatus(config.repoRoot);
  if (dirty.length && !options.allowDirty) {
    throw new Error(`refusing to apply with a dirty worktree (${dirty.slice(0, 3).join(', ')}); commit/stash it or pass --allow-dirty`);
  }
  const before = await gitDiff(config.repoRoot);
  const skill = await skillInstructions(cwd, 'aeo-improve');
  session.status = 'applying';
  session.applyStartedAt = new Date().toISOString();
  await writeJson(path.join(sessionDir, 'session.json'), session);
  options.onStage?.(`Applying approved proposal with ${options.provider || session.operatorProvider}`);
  const bin = JSON.stringify(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'aeo-agent.js'));
  const operator = await runProvider(options.provider || session.operatorProvider, applyPrompt({
    config,
    query: session.query,
    proposal,
    skill,
    toolCommand: `${JSON.stringify(process.execPath)} ${bin}`
  }), {
    cwd: config.repoRoot,
    mode: 'apply',
    timeout: options.operatorTimeout,
    onActivity: activity(options.verbose)
  });
  const after = await gitDiff(config.repoRoot);
  await writeText(path.join(sessionDir, 'apply-report.md'), operator.answer);
  await writeText(path.join(sessionDir, 'patch.diff'), after || '# No tracked diff was produced.');
  const audit = await runAudit(config, { remote: false });
  await writeJson(path.join(sessionDir, 'audit-after.json'), audit);
  session.status = 'applied';
  session.applyCompletedAt = new Date().toISOString();
  session.hadPreexistingDiff = Boolean(before);
  await writeJson(path.join(sessionDir, 'session.json'), session);
  return { session, sessionDir, report: operator.answer, patch: after, audit };
}

export async function verifyPlan(cwd, requested, options = {}) {
  const config = await loadConfig(cwd);
  const sessionDir = await resolveSession(cwd, requested);
  const session = await readJson(path.join(sessionDir, 'session.json'));
  const audit = await runAudit(config, { remote: options.remote === true });
  await writeJson(path.join(sessionDir, 'audit-verified.json'), audit);
  let blind = null;
  if (options.provider && options.provider !== 'none') {
    options.onStage?.(`Running fresh grounded verification with ${options.provider}`);
    blind = await runBlindObserver(options.provider, {
      query: session.query,
      config,
      audit,
      cwd: config.repoRoot,
      timeout: options.operatorTimeout,
      onActivity: activity(options.verbose)
    });
    await writeText(path.join(sessionDir, 'blind-verification.md'), blind.answer);
  }
  let observation = null;
  if (options.observer && options.observer !== 'none') {
    options.onStage?.(`Collecting an independent agent observation with ${options.observer}`);
    observation = await runPreview(config, {
      query: session.query,
      provider: options.observer,
      samples: options.samples || 1,
      workspace: path.join(sessionDir, 'observer-verification'),
      fixture: options.fixture,
      timeout: options.observerTimeout,
      onActivity: activity(options.verbose)
    });
    await writeJson(path.join(sessionDir, 'observer-verification.json'), observation);
  }
  session.status = observation ? 'observed' : 'verified';
  session.verifiedAt = new Date().toISOString();
  await writeJson(path.join(sessionDir, 'session.json'), session);
  return { session, sessionDir, audit, blind, observation };
}
