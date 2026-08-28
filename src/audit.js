import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const CONTENT_EXTENSIONS = new Set(['.html', '.htm', '.md', '.mdx', '.jsx', '.tsx', '.vue', '.svelte']);
const IGNORED_DIRECTORIES = new Set(['.git', '.aeo', '.aeokit', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt']);
const MAX_FILES = 250;
const MAX_BYTES = 512_000;

async function contentFiles(root) {
  const files = [];
  async function walk(directory) {
    if (files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) await walk(absolute);
      else if (entry.isFile() && CONTENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
    }
  }
  await walk(root);
  return files;
}

function count(pattern, value) {
  return [...value.matchAll(pattern)].length;
}

function inspectText(value) {
  const lower = value.toLowerCase();
  const jsonLdTypes = [...value.matchAll(/["']@type["']\s*:\s*["']([^"']+)/gi)].map((match) => match[1]);
  return {
    bytes: Buffer.byteLength(value),
    titleCount: count(/<title\b[^>]*>[\s\S]*?<\/title>/gi, value),
    descriptionCount: count(/<meta\b[^>]*name=["']description["'][^>]*>/gi, value),
    canonicalCount: count(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi, value),
    h1Count: count(/<h1\b|^#\s+/gim, value),
    externalLinks: count(/https?:\/\//gi, value),
    numericClaims: count(/\b(?:\d+(?:\.\d+)?%|\d{2,}[+,]?|v\d+(?:\.\d+)*)\b/gi, value),
    comparisonTerms: count(/\b(?:versus|\bvs\.?\b|alternative|compare|comparison)\b/gi, value),
    evidenceTerms: count(/\b(?:methodology|benchmark|case study|documentation|source|research|tested|measurement)\b/gi, value),
    dateSignals: count(/\b(?:20\d{2}-\d{2}-\d{2}|updated|published|last modified)\b/gi, value),
    noindex: /<meta\b[^>]*(?:noindex|none)[^>]*>/i.test(value),
    jsonLdTypes,
    hasOrganizationSchema: jsonLdTypes.some((type) => /^(?:organization|product|softwareapplication|webpage|article)$/i.test(type)),
    mentionsRobots: lower.includes('robots')
  };
}

function aggregate(files) {
  return files.reduce((total, file) => {
    for (const key of ['bytes', 'titleCount', 'descriptionCount', 'canonicalCount', 'h1Count', 'externalLinks', 'numericClaims', 'comparisonTerms', 'evidenceTerms', 'dateSignals']) {
      total[key] += file.signals[key];
    }
    total.noindex = total.noindex || file.signals.noindex;
    total.hasOrganizationSchema = total.hasOrganizationSchema || file.signals.hasOrganizationSchema;
    total.jsonLdTypes.push(...file.signals.jsonLdTypes);
    return total;
  }, {
    bytes: 0,
    titleCount: 0,
    descriptionCount: 0,
    canonicalCount: 0,
    h1Count: 0,
    externalLinks: 0,
    numericClaims: 0,
    comparisonTerms: 0,
    evidenceTerms: 0,
    dateSignals: 0,
    noindex: false,
    hasOrganizationSchema: false,
    jsonLdTypes: []
  });
}

export async function inspectRepository(root) {
  const names = await contentFiles(root);
  const files = [];
  for (const absolute of names) {
    let content;
    try {
      content = await readFile(absolute, 'utf8');
    } catch {
      continue;
    }
    if (Buffer.byteLength(content) > MAX_BYTES) content = content.slice(0, MAX_BYTES);
    files.push({ file: path.relative(root, absolute), signals: inspectText(content) });
  }
  return { root, scannedFiles: files.length, truncated: names.length >= MAX_FILES, signals: aggregate(files), files };
}

async function fetchText(url, timeout = 15_000) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
    headers: { 'user-agent': 'AEO-Agent/0.1 (+https://github.com/aeokit-dev/aeo-agent)' }
  });
  const text = (await response.text()).slice(0, MAX_BYTES);
  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    text
  };
}

export async function inspectSite(site) {
  const normalized = new URL(site.includes('://') ? site : `https://${site}`);
  const home = await fetchText(normalized.href);
  let robots;
  try {
    robots = await fetchText(new URL('/robots.txt', home.finalUrl).href);
  } catch (error) {
    robots = { ok: false, status: null, error: error.message, text: '' };
  }
  return {
    requestedUrl: normalized.href,
    finalUrl: home.finalUrl,
    status: home.status,
    ok: home.ok,
    contentType: home.contentType,
    signals: inspectText(home.text),
    robots: {
      status: robots.status,
      ok: robots.ok,
      blocksAll: /user-agent:\s*\*[\s\S]*?disallow:\s*\/(?:\s|$)/i.test(robots.text || ''),
      bytes: Buffer.byteLength(robots.text || ''),
      error: robots.error || null
    }
  };
}

function finding(id, severity, title, evidence, recommendation) {
  return { id, severity, title, evidence, recommendation };
}

export function evaluateAudit(config, repository, remote = null) {
  const source = repository.signals;
  const live = remote?.signals || {};
  const any = (key) => (source[key] || 0) + (live[key] || 0);
  const findings = [];
  let next = 1;
  const add = (...args) => findings.push(finding(`E${String(next++).padStart(3, '0')}`, ...args));

  if (remote && !remote.ok) add('high', 'The deployed page was not retrievable', `HTTP ${remote.status ?? 'request failed'} for ${config.site}.`, 'Restore a successful public HTML response before optimizing content.');
  if (remote?.robots?.blocksAll) add('high', 'robots.txt blocks all compliant crawlers', 'The live robots.txt contains a wildcard Disallow: /.', 'Allow the public evidence pages that answer engines should retrieve.');
  if (source.noindex || live.noindex) add('high', 'A noindex directive was detected', 'At least one inspected source or deployed page contains a noindex directive.', 'Remove noindex from pages intended to be discoverable.');
  if (!any('h1Count')) add('medium', 'No clear primary heading was detected', 'No HTML H1 or Markdown level-one heading appeared in inspected content.', 'State the product, category, and primary use case in one clear heading.');
  if (!any('descriptionCount')) add('medium', 'No meta description was detected', 'No description meta tag appeared in inspected HTML.', 'Add a factual description that identifies the product, audience, and use case.');
  if (!source.hasOrganizationSchema && !live.hasOrganizationSchema) add('medium', 'No relevant JSON-LD entity type was detected', 'Organization, Product, SoftwareApplication, WebPage, or Article schema was not found.', 'Add JSON-LD only for facts visible and supportable on the page.');
  if (any('externalLinks') < 2) add('medium', 'The evidence trail is thin', `Detected ${any('externalLinks')} external links across the inspected content.`, 'Link important factual claims to primary documentation or independent evidence.');
  if (!any('numericClaims') && !any('evidenceTerms')) add('medium', 'Claims are difficult to verify', 'No concrete measurements or evidence-oriented passages were detected.', 'Add specific, sourced capabilities, methodology, limits, or test results.');
  if (!any('comparisonTerms') && config.competitors?.length) add('low', 'Buyer comparisons are not addressed explicitly', `The profile lists ${config.competitors.length} competitors but comparison language was not detected.`, 'Add a fair, factual comparison that explains fit and tradeoffs without unsupported superiority claims.');
  if (!any('dateSignals')) add('low', 'Freshness is not explicit', 'No published, updated, or machine-readable date signal was detected.', 'Add accurate published or updated dates to evidence-bearing pages.');

  const deductions = findings.reduce((sum, item) => sum + ({ high: 22, medium: 11, low: 5 }[item.severity] || 0), 0);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evidenceLevel: 'deterministic-verification',
    scope: { brand: config.brand, site: config.site, repository: config.repoRoot },
    readinessScore: Math.max(0, 100 - deductions),
    disclaimer: 'Technical readiness is not an answer-engine ranking or proof of improved visibility.',
    repository,
    remote,
    findings
  };
}

export async function runAudit(config, options = {}) {
  const repository = await inspectRepository(config.repoRoot);
  let remote = null;
  if (options.remote !== false) {
    try {
      remote = await inspectSite(config.site);
    } catch (error) {
      remote = { ok: false, status: null, error: error.message, signals: {}, robots: { ok: false, blocksAll: false, error: error.message } };
    }
  }
  return evaluateAudit(config, repository, remote);
}
