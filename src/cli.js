import path from 'node:path';
import { parseArgs, listFlag, numberFlag } from './args.js';
import { runAudit } from './audit.js';
import { applyPlan, createPlan, defaultQuery, verifyPlan } from './harness.js';
import { commandExists } from './process.js';
import { previewBin, runPreview } from './preview.js';
import { discoverSkills } from './skills.js';
import { loadConfig, sessionsDir, stateDir, writeJson } from './store.js';
import { executeTool, toolCatalog } from './tools.js';

const version = '0.1.0';

function help() {
  console.log(`AEO Agent ${version} by AEOkit — evidence-backed AEO execution\n\nUsage:\n  aeo-agent init <url> --brand <name> --category <category> [options]\n  aeo-agent audit [--offline] [--json]\n  aeo-agent observe --query <buyer-question> --provider codex|claude|fixture\n  aeo-agent plan --query <buyer-question> [--provider codex] [--observer none]\n  aeo-agent apply [session-id|latest] [--provider codex] [--allow-dirty]\n  aeo-agent improve --query <buyer-question> [--apply]\n  aeo-agent verify [session-id|latest] [--provider codex] [--observer none]\n  aeo-agent skills [--json]\n  aeo-agent tools [--json]\n  aeo-agent doctor [--json]\n\nEvidence levels:\n  deterministic verification · directional grounded simulation · production observation\n\nAEO Agent never deploys or claims that a local patch improved public rankings.`);
}

function printAudit(audit) {
  console.log(`AEO readiness ${audit.readinessScore}/100\n${audit.disclaimer}`);
  if (!audit.findings.length) console.log('No deterministic gaps detected.');
  for (const item of audit.findings) console.log(`${item.id}  ${item.severity.padEnd(6)}  ${item.title}\n      ${item.evidence}`);
}

function stages(flags) {
  return flags.json ? undefined : (message) => console.error(`◆ ${message}`);
}

function commonOptions(flags) {
  return {
    query: flags.query === true ? undefined : flags.query,
    provider: flags.provider || 'codex',
    observer: flags.observer || 'none',
    samples: numberFlag(flags, 'samples', 1, { min: 1, max: 20 }),
    fixture: flags.fixture === true ? undefined : flags.fixture,
    remote: !flags.offline,
    verbose: Boolean(flags.verbose),
    operatorTimeout: numberFlag(flags, 'operator-timeout', 900_000, { min: 1_000, max: 3_600_000 }),
    observerTimeout: numberFlag(flags, 'observer-timeout', 180_000, { min: 1_000, max: 900_000 }),
    onStage: stages(flags)
  };
}

async function init(cwd, positional, flags) {
  const site = positional[0];
  if (!site || !flags.brand || !flags.category) throw new Error('init requires <url>, --brand, and --category');
  const config = {
    schemaVersion: 1,
    brand: String(flags.brand),
    site: new URL(String(site).includes('://') ? String(site) : `https://${site}`).href,
    category: String(flags.category),
    audience: flags.audience ? String(flags.audience) : 'software teams',
    useCase: flags['use-case'] ? String(flags['use-case']) : `evaluating ${flags.category}`,
    competitors: listFlag(flags.competitors),
    aliases: listFlag(flags.aliases),
    repoRoot: path.resolve(cwd, flags.repo === true || !flags.repo ? '.' : String(flags.repo)),
    createdAt: new Date().toISOString()
  };
  await writeJson(path.join(stateDir(cwd), 'config.json'), config);
  if (flags.json) console.log(JSON.stringify(config, null, 2));
  else console.log(`Initialized ${config.brand}\n  Site      ${config.site}\n  Repo      ${config.repoRoot}\n  State     ${path.relative(cwd, stateDir(cwd))}/`);
}

async function observe(cwd, flags) {
  const config = await loadConfig(cwd);
  const provider = flags.provider || 'codex';
  const workspace = path.join(sessionsDir(cwd), `observation-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const run = await runPreview(config, {
    query: flags.query || defaultQuery(config),
    provider,
    samples: numberFlag(flags, 'samples', 1, { min: 1, max: 20 }),
    workspace,
    fixture: flags.fixture,
    timeout: numberFlag(flags, 'timeout', 180_000, { min: 1_000, max: 900_000 }),
    onActivity: flags.verbose ? (line) => console.error(`  ${line}`) : undefined
  });
  if (flags.json) console.log(JSON.stringify(run, null, 2));
  else console.log(`Directional agent observation · ${provider}\n  Visibility  ${Math.round(run.summary.mentionRate * 100)}% (${run.summary.mentions}/${run.summary.total})\n  Citations   ${Math.round(run.summary.citationRate * 100)}% (${run.summary.citations}/${run.summary.total})\n  Evidence    ${path.relative(cwd, workspace)}\n  Boundary    Not a consumer-surface ranking.`);
}

export async function main(argv, cwd = process.cwd()) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return help();
  if (argv[0] === '--version' || argv[0] === '-V') return console.log(version);
  const { command, positional, flags } = parseArgs(argv);
  if (command === 'help' || flags.help) return help();
  if (command === 'init') return init(cwd, positional, flags);
  if (command === 'audit') {
    const audit = await runAudit(await loadConfig(cwd), { remote: !flags.offline });
    return flags.json ? console.log(JSON.stringify(audit, null, 2)) : printAudit(audit);
  }
  if (command === 'observe') return observe(cwd, flags);
  if (command === 'plan' || command === 'improve') {
    const options = commonOptions(flags);
    const result = await createPlan(cwd, options);
    if (flags.json && command === 'plan' && !flags.apply) console.log(JSON.stringify(result, null, 2));
    else if (!flags.json) console.log(`\n${result.proposal}\n\nSession ${result.id}\nApply with: aeo-agent apply ${result.id}`);
    if (command === 'improve' && flags.apply) {
      const applied = await applyPlan(cwd, result.id, { ...options, allowDirty: Boolean(flags['allow-dirty']) });
      if (flags.json) console.log(JSON.stringify(applied, null, 2));
      else console.log(`\n${applied.report}\n\nPatch saved to ${path.relative(cwd, path.join(applied.sessionDir, 'patch.diff'))}`);
    }
    return;
  }
  if (command === 'apply') {
    const options = commonOptions(flags);
    const result = await applyPlan(cwd, positional[0], { ...options, allowDirty: Boolean(flags['allow-dirty']) });
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${result.report}\n\nPatch saved to ${path.relative(cwd, path.join(result.sessionDir, 'patch.diff'))}`);
    return;
  }
  if (command === 'verify') {
    const options = commonOptions(flags);
    const result = await verifyPlan(cwd, positional[0], options);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      printAudit(result.audit);
      if (result.blind) console.log(`\nDirectional grounded simulation\n${result.blind.answer}`);
      if (result.observation) console.log(`\nDirectional agent observation: ${Math.round(result.observation.summary.mentionRate * 100)}% visibility`);
    }
    return;
  }
  if (command === 'skills') {
    const skills = await discoverSkills(cwd);
    if (flags.json) console.log(JSON.stringify(skills.map(({ instructions, ...skill }) => skill), null, 2));
    else if (!skills.length) console.log('No optional AEO skills installed. Install from aeokit-dev/aeo-skills.');
    else skills.forEach((skill) => console.log(`${skill.name.padEnd(20)} ${skill.description}`));
    return;
  }
  if (command === 'tools') return flags.json ? console.log(JSON.stringify(toolCatalog, null, 2)) : toolCatalog.forEach((tool) => console.log(`${tool.name.padEnd(16)} ${tool.evidenceLevel}\n  ${tool.purpose}`));
  if (command === 'tool') {
    const result = await executeTool(cwd, positional[0], positional.slice(1), flags);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'doctor') {
    const result = { node: process.version, git: commandExists('git'), codex: commandExists('codex'), claude: commandExists('claude'), aeoPreview: previewBin() };
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Node         ${result.node}\nGit          ${result.git ? 'ready' : 'not found'}\nCodex        ${result.codex ? 'ready' : 'not found'}\nClaude       ${result.claude ? 'ready' : 'not found'}\nAEO Preview  ready`);
    return;
  }
  throw new Error(`unknown command '${command}'`);
}
