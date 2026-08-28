import { execute } from './process.js';

const fixturePlan = `# Proposed AEO change\n\n## Hypothesis\nThe site should make its category, supported capabilities, and evidence trail easier to extract.\n\n## Change set\n- Add a concise answer-first category statement.\n- Add a factual capability table with links to supporting documentation.\n- Add valid JSON-LD that repeats only visible claims.\n\n## Verification\nRun the deterministic audit, inspect the rendered page, and repeat the unchanged buyer prompt after deployment.\n\n## Evidence\nThis fixture proposal is based on the supplied deterministic evidence IDs.`;

function codexArgs(mode) {
  return ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', mode === 'apply' ? 'workspace-write' : 'read-only', '--color', 'never', '-'];
}

function claudeArgs(mode) {
  const tools = mode === 'apply'
    ? 'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch'
    : 'Read,Glob,Grep,WebSearch,WebFetch';
  return ['--print', '--verbose', '--output-format', 'stream-json', '--no-session-persistence', '--permission-mode', mode === 'apply' ? 'acceptEdits' : 'plan', '--tools', tools];
}

export async function runProvider(provider, prompt, { cwd, mode = 'plan', timeout = 900_000, onActivity } = {}) {
  if (provider === 'fixture') return { answer: fixturePlan, usage: null, provider };
  let answer = '';
  let usage = null;
  const onLine = (line, stream) => {
    if (stream === 'stderr') {
      onActivity?.(line);
      return;
    }
    try {
      const event = JSON.parse(line);
      if (provider === 'codex') {
        const item = event.item || {};
        if (event.type === 'item.completed' && item.type === 'agent_message') answer = item.text || answer;
        if (event.type === 'turn.completed') usage = event.usage || usage;
        if (item.type === 'web_search') onActivity?.(`search · ${item.query || ''}`);
        else if (item.type === 'command_execution') onActivity?.(`tool · ${item.command || ''}`);
      } else if (event.type === 'result') {
        answer = event.result || answer;
        usage = event.usage || usage;
      }
    } catch { /* Provider noise stays out of the evidence record. */ }
  };

  if (provider === 'codex') await execute('codex', codexArgs(mode), { cwd, input: prompt, timeout, onLine });
  else if (provider === 'claude') await execute('claude', claudeArgs(mode), { cwd, input: prompt, timeout, onLine });
  else throw new Error(`unknown agent provider '${provider}' (expected codex, claude, or fixture)`);
  if (!answer.trim()) throw new Error(`${provider} completed without an agent answer`);
  return { answer: answer.trim(), usage, provider };
}

export async function runBlindObserver(provider, { query, config, audit, cwd, timeout, onActivity }) {
  const prompt = `You are a blind AEO verification observer. You did not see the optimizing agent's reasoning or desired conclusion.\n\nBuyer question: ${query}\nBrand: ${config.brand}\nCategory: ${config.category}\n\nEvaluate only the supplied post-change deterministic snapshot. Decide whether it contains clear, extractable, and supportable evidence that could help an independent researcher answer the buyer question. Identify unsupported claims and missing evidence. Do not claim that public answer-engine visibility improved; this is a directional grounded simulation. Cite audit evidence IDs in every finding.\n\nAUDIT SNAPSHOT\n${JSON.stringify({ readinessScore: audit.readinessScore, findings: audit.findings, repository: audit.repository.signals }, null, 2)}\n\nReturn concise Markdown with: Verdict, Evidence used, Remaining gaps, and Production observation to rerun.`;
  return runProvider(provider, prompt, { cwd, mode: 'plan', timeout, onActivity });
}
