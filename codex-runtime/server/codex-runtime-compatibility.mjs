import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const CODEX_RUNTIME_COMPATIBILITY_SCHEMA_VERSION = 1;

const DESKTOP_CONNECT_ANCHOR = 'async function J8e(){Y8e=q8e(),Am=await Y8e.services,Am.clientCoordination!=null&&h8e(Am.clientCoordination),Am.terminal!=null&&G3e(Am.terminal),Am.devboxService}';
const MAIN_AWAIT_ANCHOR = 'await V(),await ne(),u(),';
const MAIN_STARTUP_ANCHOR = 'let e=G||K||l.startup==null?void 0:Promise.resolve(l.startup.whenReady());';
const MAIN_STARTUP_REFERENCE = 'l.startup';

export function createCodexRuntimeCompatibility({
  runtimeRoot,
  baselinePath = path.join(runtimeRoot, 'output', 'codex-runtimes', 'known-good.json'),
  now = () => new Date(),
} = {}) {
  const resolvedRuntimeRoot = path.resolve(String(runtimeRoot || ''));
  const resolvedBaselinePath = path.resolve(String(baselinePath || path.join(resolvedRuntimeRoot, 'known-good.json')));
  let snapshot = {
    schemaVersion: CODEX_RUNTIME_COMPATIBILITY_SCHEMA_VERSION,
    state: 'uninspected',
    ready: false,
    runtimeRoot: resolvedRuntimeRoot,
    baselinePath: resolvedBaselinePath,
    patchAssets: [],
    checks: {},
    errors: [],
  };
  let inspection = null;

  async function inspect() {
    if (!inspection) inspection = inspectRuntime();
    return inspection;
  }

  function status() {
    return cloneStatus(snapshot);
  }

  function transform(filePath, source) {
    const absolute = path.resolve(filePath);
    const patch = snapshot.patchAssets.find((entry) => samePath(entry.file, absolute));
    if (!patch) return { matched: false, source };
    const text = String(source);
    if (patch.kind === 'app-initial') {
      if (countOccurrences(text, DESKTOP_CONNECT_ANCHOR) !== 1) {
        return { matched: true, ok: false, errorCode: 'CODEX_RUNTIME_PATCH_ANCHOR_CHANGED', errorMessage: 'Codex app-initial startup anchor changed after inspection.' };
      }
      const browserConnect = buildBrowserConnect(snapshot.desktop);
      return { matched: true, ok: true, source: text.replace(DESKTOP_CONNECT_ANCHOR, browserConnect), patch: patch.kind };
    }
    if (patch.kind === 'app-main') {
      const counts = {
        awaitAnchor: countOccurrences(text, MAIN_AWAIT_ANCHOR),
        startupAnchor: countOccurrences(text, MAIN_STARTUP_ANCHOR),
        startupReference: countOccurrences(text, MAIN_STARTUP_REFERENCE),
      };
      if (counts.awaitAnchor !== 1 || counts.startupAnchor !== 1 || counts.startupReference < 1) {
        return { matched: true, ok: false, errorCode: 'CODEX_RUNTIME_PATCH_ANCHOR_CHANGED', errorMessage: 'Codex app-main startup anchors changed after inspection.' };
      }
      const sourceWithAwait = text.replace(MAIN_AWAIT_ANCHOR, 'await V(),ne().catch(()=>{}),u(),');
      const sourceWithStartup = sourceWithAwait.replace(
        MAIN_STARTUP_ANCHOR,
        'let e=G||K||l==null||l.startup==null?void 0:Promise.resolve(l.startup.whenReady());',
      );
      return {
        matched: true,
        ok: true,
        source: sourceWithStartup.replaceAll(MAIN_STARTUP_REFERENCE, 'l?.startup'),
        patch: patch.kind,
      };
    }
    return { matched: true, ok: false, errorCode: 'CODEX_RUNTIME_PATCH_UNKNOWN', errorMessage: `Unknown Codex runtime patch kind: ${patch.kind}` };
  }

  async function inspectRuntime() {
    const startedAt = Date.now();
    const next = {
      schemaVersion: CODEX_RUNTIME_COMPATIBILITY_SCHEMA_VERSION,
      state: 'incompatible',
      ready: false,
      runtimeRoot: resolvedRuntimeRoot,
      baselinePath: resolvedBaselinePath,
      inspectedAt: now().toISOString(),
      durationMs: 0,
      patchAssets: [],
      checks: {},
      errors: [],
    };
    try {
      const layout = await resolveRuntimeLayout(resolvedRuntimeRoot);
      next.layout = layout.public;
      next.desktop = layout.package;
      next.checks.layout = true;
      const candidates = await discoverPatchAssets(layout.assetsRoot);
      next.patchAssets = candidates.map(({ kind, file }) => ({ kind, file }));
      next.checks.appInitialAnchor = candidates.some((entry) => entry.kind === 'app-initial');
      next.checks.appMainAnchors = candidates.some((entry) => entry.kind === 'app-main');
      next.checks.index = true;
      next.checks.appServer = await fileExists(layout.appServerPath);
      next.checks.preload = await fileExists(layout.preloadPath);
      next.fingerprint = await fingerprintRuntime(layout, candidates);
      next.baseline = await readBaseline(resolvedBaselinePath, next.fingerprint);
      next.checks.baseline = next.baseline.state !== 'mismatch';
      const failed = Object.entries(next.checks).filter(([, value]) => !value).map(([key]) => key);
      next.errors = failed.map((key) => ({ code: `CODEX_RUNTIME_${key.toUpperCase()}_CHECK_FAILED`, message: `${key} compatibility check failed.` }));
      next.ready = failed.length === 0;
      next.state = next.ready ? 'ready' : 'incompatible';
    } catch (error) {
      next.errors.push({
        code: String(error?.code || 'CODEX_RUNTIME_INSPECTION_FAILED'),
        message: String(error?.message || error),
      });
      next.state = 'incompatible';
      next.ready = false;
    }
    next.durationMs = Date.now() - startedAt;
    snapshot = next;
    return cloneStatus(snapshot);
  }

  return Object.freeze({ inspect, status, transform });
}

export async function writeCodexRuntimeBaseline({ compatibility, baselinePath }) {
  if (!compatibility || typeof compatibility.inspect !== 'function') throw new Error('Codex runtime compatibility service is required.');
  const status = await compatibility.inspect();
  if (!status.ready || !status.fingerprint) {
    const error = new Error('Cannot record an incompatible Codex runtime as known-good.');
    error.code = 'CODEX_RUNTIME_NOT_READY';
    throw error;
  }
  const target = path.resolve(String(baselinePath || status.baselinePath));
  const baseline = {
    schemaVersion: CODEX_RUNTIME_COMPATIBILITY_SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
    fingerprint: status.fingerprint,
    desktop: status.desktop,
    patchAssets: status.patchAssets,
  };
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return baseline;
}

async function resolveRuntimeLayout(runtimeRoot) {
  const fullUnpackedRoot = path.join(runtimeRoot, 'app', 'resources', 'app-unpacked');
  const unpackedRoot = await fileExists(path.join(fullUnpackedRoot, 'webview', 'index.html'))
    ? fullUnpackedRoot
    : runtimeRoot;
  const webviewRoot = path.join(unpackedRoot, 'webview');
  const assetsRoot = path.join(webviewRoot, 'assets');
  const packagePath = path.join(unpackedRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  const appServerPath = path.join(runtimeRoot, 'app', 'resources', 'codex.exe');
  const preloadPath = path.join(unpackedRoot, '.vite', 'build', 'preload.js');
  if (!(await fileExists(path.join(webviewRoot, 'index.html')))) {
    const error = new Error(`Codex webview index is missing under ${webviewRoot}.`);
    error.code = 'CODEX_RUNTIME_WEBVIEW_MISSING';
    throw error;
  }
  return {
    webviewRoot,
    assetsRoot,
    packagePath,
    appServerPath,
    preloadPath,
    indexPath: path.join(webviewRoot, 'index.html'),
    package: {
      version: String(packageJson.version || ''),
      buildNumber: String(packageJson.codexBuildNumber || ''),
      buildFlavor: String(packageJson.codexBuildFlavor || ''),
      packageIdentity: String(packageJson.codexWindowsPackageIdentity || ''),
    },
    public: {
      webviewRoot,
      assetsRoot,
      appServerPath,
      preloadPath,
    },
  };
}

async function discoverPatchAssets(assetsRoot) {
  const candidates = [];
  for (const file of await listFiles(assetsRoot)) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(file, 'utf8');
    if (countOccurrences(source, DESKTOP_CONNECT_ANCHOR) === 1) candidates.push({ kind: 'app-initial', file });
    if (
      countOccurrences(source, MAIN_AWAIT_ANCHOR) === 1
      && countOccurrences(source, MAIN_STARTUP_ANCHOR) === 1
      && countOccurrences(source, MAIN_STARTUP_REFERENCE) >= 1
    ) candidates.push({ kind: 'app-main', file });
  }
  const byKind = new Map();
  for (const entry of candidates) {
    const list = byKind.get(entry.kind) || [];
    list.push(entry);
    byKind.set(entry.kind, list);
  }
  for (const kind of ['app-initial', 'app-main']) {
    const list = byKind.get(kind) || [];
    if (list.length !== 1) {
      const error = new Error(`Expected exactly one ${kind} patch candidate, found ${list.length}.`);
      error.code = 'CODEX_RUNTIME_PATCH_CANDIDATE_COUNT';
      throw error;
    }
  }
  return candidates;
}

async function fingerprintRuntime(layout, candidates) {
  const files = [
    layout.indexPath,
    layout.packagePath,
    layout.preloadPath,
    layout.appServerPath,
    ...candidates.map((entry) => entry.file),
  ];
  const uniqueFiles = [...new Set(files)];
  const entries = [];
  for (const file of uniqueFiles) {
    if (!(await fileExists(file))) continue;
    const relative = path.relative(layout.webviewRoot, file).replaceAll('\\', '/');
    entries.push({ path: relative, sha256: await hashFile(file), bytes: (await stat(file)).size });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const aggregate = createHash('sha256');
  for (const entry of entries) aggregate.update(`${entry.path}\0${entry.bytes}\0${entry.sha256}\n`);
  return {
    rendererEntrySha256: aggregate.digest('hex'),
    files: entries,
  };
}

async function readBaseline(filePath, fingerprint) {
  let value;
  try {
    value = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing', path: filePath };
    return { state: 'invalid', path: filePath, error: String(error?.message || error) };
  }
  const expected = String(value?.fingerprint?.rendererEntrySha256 || '');
  return {
    state: expected && expected === fingerprint.rendererEntrySha256 ? 'match' : 'mismatch',
    path: filePath,
    expected: expected || null,
    actual: fingerprint.rendererEntrySha256,
  };
}

function buildBrowserConnect(desktop = {}) {
  const version = JSON.stringify(desktop.version || 'unknown');
  const buildNumber = JSON.stringify(desktop.buildNumber || 'unknown');
  const buildFlavor = JSON.stringify(desktop.buildFlavor || 'prod');
  return `async function J8e(){Am={localThreadCatalog:null,threadProjectAssignments:{setAssignment:async()=>{}},clientCoordination:null,terminal:null,devboxService:null,startup:null,requestUserInputAutoResolution:{setConversationPresented(){},recordConversationActivity(){},snooze(){}},appInfo:{get:async()=>({appVersion:${version},version:${version},buildNumber:${buildNumber},buildFlavor:${buildFlavor}})}}}`;
}

function countOccurrences(source, needle) {
  let offset = 0;
  let count = 0;
  while (true) {
    const index = source.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function cloneStatus(value) {
  return JSON.parse(JSON.stringify(value));
}
