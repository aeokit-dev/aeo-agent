import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectRepository, runAudit } from '../src/audit.js';

async function fixtureSite() {
  const root = await mkdtemp(path.join(tmpdir(), 'aeokit-audit-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'index.html'), `<!doctype html>
    <html><head><title>Acme Evidence</title><meta name="description" content="A factual test site">
    <link rel="canonical" href="https://example.com"><script type="application/ld+json">{"@type":"SoftwareApplication"}</script></head>
    <body><h1>Acme testing software</h1><p>Updated 2026-08-27. Tested against 100 cases.</p>
    <a href="https://example.org/methodology">Methodology</a><a href="https://example.net/docs">Documentation</a></body></html>`);
  return root;
}

test('inspects extractable evidence without traversing generated directories', async () => {
  const root = await fixtureSite();
  const result = await inspectRepository(root);
  assert.equal(result.scannedFiles, 1);
  assert.equal(result.signals.hasOrganizationSchema, true);
  assert.equal(result.signals.h1Count, 1);
  assert.ok(result.signals.externalLinks >= 2);
});

test('labels local-only audit evidence as deterministic verification', async () => {
  const root = await fixtureSite();
  const audit = await runAudit({ brand: 'Acme', site: 'https://example.com', repoRoot: root, competitors: [] }, { remote: false });
  assert.equal(audit.evidenceLevel, 'deterministic-verification');
  assert.match(audit.disclaimer, /not an answer-engine ranking/);
  assert.ok(audit.readinessScore >= 0 && audit.readinessScore <= 100);
});
