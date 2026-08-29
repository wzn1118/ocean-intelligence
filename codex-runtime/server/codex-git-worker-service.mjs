import { spawn } from 'node:child_process';
import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';

import { createGitWorktreeManager } from './copilot/git-worktree-manager.mjs';

const WORKER_ID = 'git';
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_REVIEW_FILES = 200;
const MAX_REVIEW_SEARCH_MATCHES = 250;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,200}$/u;
const READ_METHODS = new Set([
  'availability',
  'stable-metadata',
  'current-branch',
  'current-branch-snapshot',
  'upstream-branch',
  'branch-ahead-count',
  'default-branch',
  'base-branch',
  'recent-branches',
  'branch-exists',
  'branch-commits',
  'branch-diff-stats',
  'search-branches',
  'nearest-ancestor-branch',
  'branch-metadata',
  'status-summary',
  'submodule-paths',
  'git-origins',
  'config-value',
  'list-worktrees',
  'worktree-status',
  'review-summary',
  'review-diff',
  'review-patch',
  'review-search',
  'commit-message-diff',
]);
const CONTROL_METHODS = new Set([
  'watch-repo',
  'unwatch-repo',
  'invalidate-stable-metadata',
  'invalidate-git-read-caches',
  'dispose-git-init-watch',
]);
const MUTATION_METHODS = new Set([
  'set-config-value',
  'commit',
  'git-init-repo',
  'apply-changes',
  'apply-patch',
  'apply-review-section-changes',
  'create-worktree',
  'remove-worktree',
  'prune-worktrees',
]);

export function createCodexGitWorkerService(options = {}) {
  return new CodexGitWorkerService(options);
}

export class CodexGitWorkerService {
  constructor({
    workspaceRoot = process.cwd(),
    worktreeRoot = '',
    gitCommand = 'git',
    spawnImpl = spawn,
    timeoutMs = 30_000,
    maxOutputBytes = MAX_OUTPUT_BYTES,
  } = {}) {
    this.workspaceRoot = path.resolve(String(workspaceRoot || process.cwd()));
    this.worktreeRoot = path.resolve(String(worktreeRoot || path.join(this.workspaceRoot, '.agent-worktrees')));
    this.gitCommand = String(gitCommand || 'git').trim();
    this.spawnImpl = spawnImpl;
    this.timeoutMs = Math.max(1_000, Math.min(120_000, Number(timeoutMs) || 30_000));
    this.maxOutputBytes = Math.max(64 * 1024, Math.min(MAX_OUTPUT_BYTES, Number(maxOutputBytes) || MAX_OUTPUT_BYTES));
    this.inFlight = new Map();
    this.subscriptions = new Map();
    this.nextSubscriptionGeneration = 1;
    this.reviewSnapshots = new Map();
    this.nextReviewSnapshotGeneration = 1;
    this.workspaceRealPath = null;
    this.stats = {
      requests: 0,
      responses: 0,
      events: 0,
      cancellations: 0,
      errors: 0,
    };
  }

  capabilities() {
    return {
      workerIds: [WORKER_ID],
      protocol: 'codex-electron-worker.v1',
      methods: {
        read: [...READ_METHODS],
        control: [...CONTROL_METHODS, 'subscribe-live-query', 'recover-live-queries'],
        mutation: [...MUTATION_METHODS],
      },
    };
  }

  status() {
    return {
      schemaVersion: 1,
      state: 'ready',
      workspaceRoot: this.workspaceRoot,
      worktreeRoot: this.worktreeRoot,
      activeRequests: this.inFlight.size,
      activeSubscriptions: this.subscriptions.size,
      capabilities: this.capabilities(),
      ...this.stats,
    };
  }

  async handleMessage(workerId, message, { sessionId = 'anonymous' } = {}) {
    this.stats.requests += 1;
    try {
      assertWorkerMessage(workerId, message);
      const requestScope = `${String(sessionId || 'anonymous')}\0${message.id || message.request?.id || ''}`;
      if (message.type === 'worker-request-cancel') {
        this.stats.cancellations += 1;
        this.inFlight.get(requestScope)?.abort();
        this.inFlight.delete(requestScope);
        this.subscriptions.delete(requestScope);
        return { accepted: true, workerId: WORKER_ID, messages: [] };
      }
      const request = message.request;
      if (request.method === 'subscribe-live-query') {
        const result = await this.#subscribeLiveQuery(request, requestScope);
        this.stats.events += result.messages.length;
        return result;
      }
      if (request.method === 'recover-live-queries') {
        return { accepted: true, workerId: WORKER_ID, messages: [workerSuccess(request, undefined)] };
      }
      const controller = new AbortController();
      this.inFlight.set(requestScope, controller);
      try {
        const value = await this.#execute(request.method, request.params || {}, controller.signal);
        this.stats.responses += 1;
        return { accepted: true, workerId: WORKER_ID, messages: [workerSuccess(request, value)] };
      } finally {
        if (this.inFlight.get(requestScope) === controller) this.inFlight.delete(requestScope);
      }
    } catch (error) {
      this.stats.errors += 1;
      const request = message?.request;
      if (request?.id && request?.method) {
        return { accepted: true, workerId: WORKER_ID, messages: [workerFailure(request, error)] };
      }
      throw error;
    }
  }

  async #subscribeLiveQuery(request, requestScope) {
    const params = objectValue(request.params);
    const subscriptionId = requiredString(params.subscriptionId, 'subscriptionId', 64 * 1024);
    const query = objectValue(params.query);
    const method = requiredString(query.method, 'query.method', 120);
    if (method === 'subscribe-live-query') throw workerError('CODEX_GIT_WORKER_QUERY_INVALID', 'Nested live queries are invalid.');
    const generation = this.nextSubscriptionGeneration;
    this.nextSubscriptionGeneration += 1;
    this.subscriptions.set(requestScope, { subscriptionId, method, generation });
    try {
      const value = await this.#execute(method, { ...objectValue(query.params), hostConfig: params.hostConfig }, new AbortController().signal);
      return {
        accepted: true,
        workerId: WORKER_ID,
        messages: [{
          type: 'worker-event',
          workerId: WORKER_ID,
          event: {
            type: 'git-live-query-updated',
            subscriptionId,
            method,
            generation,
            requiresRecovery: false,
            phase: 'complete',
            emittedAtMs: Date.now(),
            result: value,
            ...(request.trace && typeof request.trace === 'object' ? { trace: request.trace } : {}),
          },
        }],
      };
    } catch (error) {
      return {
        accepted: true,
        workerId: WORKER_ID,
        messages: [{
          type: 'worker-event',
          workerId: WORKER_ID,
          event: {
            type: 'git-live-query-failed',
            subscriptionId,
            method,
            generation,
            phase: 'complete',
            emittedAtMs: Date.now(),
            error: { message: String(error?.message || error) },
            ...(request.trace && typeof request.trace === 'object' ? { trace: request.trace } : {}),
          },
        }],
      };
    }
  }

  async #execute(method, params, signal) {
    if (CONTROL_METHODS.has(method)) return { success: true };
    if (method === 'availability') {
      const result = await this.#run(this.workspaceRoot, ['--version'], { signal, allowFailure: true, validatePath: false });
      return { available: result.code === 0 };
    }
    if (method === 'stable-metadata') {
      const repository = await this.#repository(params.cwd, signal, { nullable: true });
      return repository ? { commonDir: repository.commonDir, root: repository.root } : null;
    }
    if (method === 'git-origins') return this.#gitOrigins(params, signal);
    if (method === 'git-init-repo') return this.#gitInit(params, signal);

    const location = params.cwd || params.root || params.destinationRoot;
    const repository = await this.#repository(location, signal);
    switch (method) {
      case 'current-branch':
      case 'current-branch-snapshot':
        return { branch: await this.#currentBranch(repository.root, signal) };
      case 'upstream-branch':
        return this.#upstreamBranch(repository.root, signal);
      case 'branch-ahead-count':
        return this.#branchAheadCount(repository.root, signal);
      case 'default-branch':
      case 'base-branch':
        return { branch: await this.#defaultBranch(repository.root, signal) };
      case 'recent-branches':
        return this.#recentBranches(repository.root, params, signal);
      case 'branch-exists':
        return this.#branchExists(repository.root, params.branch, signal);
      case 'branch-commits':
        return this.#branchCommits(repository.root, params, signal);
      case 'branch-diff-stats':
        return this.#branchDiffStats(repository.root, params, signal);
      case 'search-branches':
        return this.#searchBranches(repository.root, params, signal);
      case 'nearest-ancestor-branch':
        return this.#nearestAncestorBranch(repository.root, params, signal);
      case 'branch-metadata':
        return { commonDir: repository.commonDir, root: repository.root, branch: await this.#currentBranch(repository.root, signal) };
      case 'status-summary':
        return this.#statusSummary(repository.root, params, signal);
      case 'submodule-paths':
        return this.#submodulePaths(repository.root, signal);
      case 'config-value':
        return this.#configValue(repository.root, params, signal);
      case 'set-config-value':
        return this.#setConfigValue(repository.root, params, signal);
      case 'list-worktrees':
        return this.#listWorktrees(repository.root, signal);
      case 'worktree-status':
        return this.#worktreeStatus(repository.root, params, signal);
      case 'review-summary':
        return this.#reviewSummary(repository.root, params, signal);
      case 'review-diff':
        return this.#reviewDiff(repository.root, params, signal);
      case 'review-patch':
        return this.#reviewPatch(repository.root, params, signal);
      case 'review-search':
        return this.#reviewSearch(repository.root, params, signal);
      case 'commit-message-diff':
        return this.#commitMessageDiff(repository.root, params, signal);
      case 'apply-patch':
        return this.#applyPatch(repository.root, params, signal);
      case 'apply-review-section-changes':
        return this.#applyReviewSectionChanges(repository.root, params, signal);
      case 'apply-changes':
        return this.#applyChanges(repository.root, params, signal);
      case 'create-worktree':
        return this.#createWorktree(repository.root, params, signal);
      case 'remove-worktree':
        return this.#removeWorktree(repository.root, params, signal);
      case 'prune-worktrees':
        return this.#pruneWorktrees(repository.root, signal);
      case 'commit':
        return this.#commit(repository.root, params, signal);
      default:
        throw workerError('CODEX_GIT_WORKER_METHOD_NOT_IMPLEMENTED', `Git worker method is not implemented: ${method}`, 501);
    }
  }

  async #repository(value, signal, { nullable = false } = {}) {
    let requested;
    try {
      requested = await this.#assertAllowedPath(value);
    } catch (error) {
      if (nullable && ['CODEX_GIT_WORKER_PATH_OUTSIDE_WORKSPACE', 'CODEX_GIT_WORKER_PATH_UNAVAILABLE'].includes(error?.code)) return null;
      throw error;
    }
    const rootResult = await this.#run(requested, ['rev-parse', '--show-toplevel'], { signal, allowFailure: nullable });
    if (rootResult.code !== 0) return null;
    const root = await this.#assertAllowedPath(rootResult.stdout.trim());
    const commonResult = await this.#run(root, ['rev-parse', '--git-common-dir'], { signal });
    const commonValue = commonResult.stdout.trim();
    const commonDir = path.resolve(root, commonValue);
    return { root, commonDir };
  }

  async #currentBranch(root, signal) {
    const result = await this.#run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { signal, allowFailure: true });
    return result.code === 0 ? result.stdout.trim() || null : null;
  }

  async #upstreamBranch(root, signal) {
    const branch = await this.#currentBranch(root, signal);
    const result = await this.#run(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { signal, allowFailure: true });
    return { branch, upstream: result.code === 0 ? { branch: result.stdout.trim() } : null };
  }

  async #branchAheadCount(root, signal) {
    const result = await this.#run(root, ['rev-list', '--count', '@{upstream}..HEAD'], { signal, allowFailure: true });
    return { commitsAhead: result.code === 0 ? Number.parseInt(result.stdout.trim(), 10) || 0 : 0 };
  }

  async #defaultBranch(root, signal) {
    const symbolic = await this.#run(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { signal, allowFailure: true });
    if (symbolic.code === 0) return symbolic.stdout.trim().replace(/^origin\//u, '') || null;
    for (const candidate of ['main', 'master']) {
      if ((await this.#branchExists(root, candidate, signal)).exists) return candidate;
    }
    return this.#currentBranch(root, signal);
  }

  async #recentBranches(root, params, signal) {
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 10));
    const result = await this.#run(root, ['for-each-ref', '--sort=-committerdate', `--count=${limit}`, '--format=%(refname:short)', 'refs/heads'], { signal });
    return { branches: result.stdout.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean) };
  }

  async #branchExists(root, value, signal) {
    const branch = await this.#validBranch(root, value, signal);
    const result = await this.#run(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { signal, allowFailure: true });
    return { exists: result.code === 0 };
  }

  async #branchCommits(root, params, signal) {
    const base = await this.#validRevision(params.baseBranch || (await this.#defaultBranch(root, signal)) || 'HEAD', 'baseBranch');
    const result = await this.#run(root, ['log', '--max-count=100', '--date=iso-strict', '--format=%H%x00%h%x00%an%x00%aI%x00%s', `${base}..HEAD`], { signal });
    return {
      commits: result.stdout.split(/\r?\n/u).filter(Boolean).map((line) => {
        const [sha, shortSha, author, authoredAt, subject] = line.split('\0');
        return { sha, shortSha, author, authoredAt, subject };
      }),
    };
  }

  async #branchDiffStats(root, params, signal) {
    const files = await this.#reviewFiles(root, { ...params, source: 'branch' }, signal);
    return files.reduce((summary, file) => ({
      fileCount: summary.fileCount + 1,
      additions: summary.additions + (file.additions || 0),
      deletions: summary.deletions + (file.deletions || 0),
    }), { fileCount: 0, additions: 0, deletions: 0 });
  }

  async #reviewSummary(root, params, signal) {
    const source = String(params.source || 'branch');
    if (!['branch', 'commit', 'staged', 'uncommitted', 'unstaged'].includes(source)) {
      return { type: 'error', source, failureReason: 'unsupported_source' };
    }
    const files = await this.#reviewFiles(root, { ...params, source }, signal);
    const status = await this.#statusSummary(root, { includeUntrackedFiles: params.includeUntrackedFiles !== false }, signal);
    const snapshotGeneration = await this.#reviewSnapshotGeneration(root, signal);
    const indexResult = await this.#run(root, ['ls-files', '-s', '-z'], { signal });
    const indexOids = parseIndexOids(indexResult.stdout);
    const versionedFiles = await mapLimit(files, 8, async (file) => ({
      ...file,
      revision: await this.#reviewFileRevision(root, source, snapshotGeneration, file, indexOids),
    }));
    return {
      type: 'success',
      source,
      files: versionedFiles,
      snapshotGeneration,
      stageCounts: {
        stagedFileCount: status.stagedCount,
        unstagedFileCount: status.unstagedCount,
        untrackedFileCount: status.untrackedCount || 0,
      },
      untrackedFilesOmitted: null,
    };
  }

  async #reviewFiles(root, params, signal) {
    const source = String(params.source || 'branch');
    const whitespaceArgs = params.hideWhitespace === true ? ['--ignore-all-space'] : [];
    const args = await this.#reviewDiffCommand(root, params, signal);
    const pathspecs = Array.isArray(params.paths)
      ? params.paths.slice(0, MAX_REVIEW_FILES).map((entry) => validGitPath(entry, 'pathspec'))
      : [];
    const [statsResult, statusResult] = await Promise.all([
      this.#run(root, [
        ...args,
        '--no-renames',
        '--numstat',
        '-z',
        ...whitespaceArgs,
        '--',
        ...pathspecs,
      ], { signal, allowFailure: true }),
      this.#run(root, [
        ...args,
        '--no-renames',
        '--name-status',
        '-z',
        ...whitespaceArgs,
        '--',
        ...pathspecs,
      ], { signal, allowFailure: true }),
    ]);
    if (statsResult.code !== 0 || statusResult.code !== 0) {
      const failure = statsResult.code !== 0 ? statsResult : statusResult;
      throw workerError('CODEX_GIT_WORKER_DIFF_FAILED', failure.stderr.trim() || 'Failed to read Git diff metadata.', 409);
    }
    const changeKinds = parseNameStatus(statusResult.stdout);
    const files = parseNumstat(statsResult.stdout).map((file) => ({
      ...file,
      changeKind: changeKinds.get(file.path) || 'modified',
    }));
    const includesUntracked = params.includeUntrackedFiles !== false && ['branch', 'uncommitted', 'unstaged'].includes(source);
    if (!includesUntracked) return files;
    const known = new Set(files.map((file) => file.path));
    for (const untrackedPath of await this.#untrackedPaths(root, signal)) {
      if (pathspecs.length && !pathspecs.some((pathspec) => untrackedPath === pathspec || untrackedPath.startsWith(`${pathspec.replace(/[\\/]+$/u, '')}/`))) continue;
      if (!known.has(untrackedPath)) files.push({ path: untrackedPath, previousPath: null, additions: 0, deletions: 0, changeKind: 'untracked' });
    }
    return files;
  }

  async #reviewDiff(root, params, signal) {
    const source = String(params.source || 'branch');
    const files = Array.isArray(params.files) ? params.files.slice(0, MAX_REVIEW_FILES).map((value) => {
      const file = objectValue(value);
      return {
        path: validGitPath(file.path, 'file.path'),
        previousPath: file.previousPath == null ? null : validGitPath(file.previousPath, 'file.previousPath'),
        changeKind: String(file.changeKind || 'modified'),
      };
    }) : [];
    if (!isReviewSource(source)) return reviewDiffErrors(source, files);
    const requestedGeneration = Number(params.snapshotGeneration);
    const currentGeneration = this.reviewSnapshots.get(root)?.generation;
    if (Number.isFinite(requestedGeneration) && currentGeneration != null && requestedGeneration !== currentGeneration) {
      return { type: 'stale-snapshot', source };
    }
    const untrackedPaths = new Set(await this.#untrackedPaths(root, signal));
    const entries = await mapLimit(files, 8, async (file) => {
      const isUntracked = file.changeKind === 'untracked' || untrackedPaths.has(file.path);
      const diff = isUntracked
        ? await this.#untrackedDiff(root, file.path, signal)
        : await this.#trackedReviewDiff(root, { ...params, source }, file, signal);
      return [file.path, diff];
    });
    return { source, diffs: Object.fromEntries(entries) };
  }

  async #reviewPatch(root, params, signal) {
    const source = String(params.source || 'branch');
    if (!isReviewSource(source)) return { source, diff: reviewError('unknown') };
    const tracked = await this.#runReviewDiff(root, { ...params, source }, [], signal);
    if (tracked.code !== 0) return { source, diff: reviewError('unknown') };
    const sections = [tracked.stdout];
    if (params.includeUntrackedFiles !== false && ['branch', 'uncommitted', 'unstaged'].includes(source)) {
      const untracked = await this.#untrackedPaths(root, signal);
      const patches = await mapLimit(untracked.slice(0, MAX_REVIEW_FILES), 8, async (filePath) => this.#untrackedDiff(root, filePath, signal));
      const failed = patches.find((entry) => entry.type === 'error');
      if (failed) return { source, diff: failed };
      sections.push(...patches.map((entry) => entry.diff));
    }
    const unifiedDiff = joinPatchSections(sections);
    const unifiedDiffBytes = Buffer.byteLength(unifiedDiff, 'utf8');
    if (unifiedDiffBytes > this.maxOutputBytes) {
      return { source, diff: reviewError('diff-too-large', { limitBytes: this.maxOutputBytes }) };
    }
    return { source, diff: { type: 'success', unifiedDiff, unifiedDiffBytes } };
  }

  async #commitMessageDiff(root, params, signal) {
    const source = params.includeUnstaged === true ? 'uncommitted' : 'staged';
    const result = await this.#runReviewDiff(root, { source }, [], signal);
    if (result.code !== 0) return reviewError('unknown');
    return {
      type: 'success',
      unifiedDiff: result.stdout,
      unifiedDiffBytes: Buffer.byteLength(result.stdout, 'utf8'),
    };
  }

  async #applyPatch(root, params, signal) {
    const diff = requiredPatch(params.diff);
    const target = String(params.target || 'unstaged');
    if (!['unstaged', 'staged', 'staged-and-unstaged'].includes(target)) {
      throw workerError('CODEX_GIT_WORKER_PATCH_TARGET_INVALID', 'Patch target is invalid.');
    }
    const paths = patchPaths(diff);
    if (paths.length === 0) {
      throw workerError('CODEX_GIT_WORKER_PATCH_INVALID', 'Patch does not describe a repository file.');
    }
    for (const filePath of paths) validGitPath(filePath, 'patch.path');
    const args = ['apply'];
    if (params.revert === true) args.push('-R');
    if (params.allowBinary === true) args.push('--binary');
    if (params.atomic !== true) args.push('--3way');
    if (target === 'staged') args.push('--cached');
    else if (target === 'staged-and-unstaged') args.push('--index');
    const result = await this.#run(root, args, { signal, allowFailure: true, input: diff });
    const conflictedPaths = result.code === 0 ? [] : patchFailurePaths(result.stderr, paths);
    const status = result.code === 0 ? 'success' : params.atomic === true ? 'error' : 'partial-success';
    if (status !== 'error' || paths.length > 0) this.reviewSnapshots.delete(root);
    return {
      status,
      appliedPaths: result.code === 0 ? paths : [],
      skippedPaths: result.code === 0 ? [] : paths.filter((filePath) => !conflictedPaths.includes(filePath)),
      conflictedPaths,
      ...(result.code === 0 ? {} : { errorCode: 'apply-failed' }),
      execOutput: gitExecOutput(args, result),
    };
  }

  async #applyReviewSectionChanges(root, params, signal) {
    const action = String(params.action || '');
    const source = String(params.source || '');
    if (!['stage', 'unstage', 'revert'].includes(action)) {
      throw workerError('CODEX_GIT_WORKER_REVIEW_ACTION_INVALID', 'Review action is invalid.');
    }
    if (!['staged', 'unstaged'].includes(source)) {
      throw workerError('CODEX_GIT_WORKER_REVIEW_SOURCE_INVALID', 'Section mutations require staged or unstaged review source.');
    }
    const requestedFiles = Array.isArray(params.files) ? params.files.slice(0, MAX_REVIEW_FILES) : [];
    if (requestedFiles.length === 0) return emptyPatchResult('error');
    const summary = await this.#reviewSummary(root, { source, includeUntrackedFiles: true }, signal);
    if (summary.type !== 'success') return emptyPatchResult('error');
    const currentFiles = new Map(summary.files.map((file) => [file.path, file]));
    const files = requestedFiles.map((entry) => {
      const requested = objectValue(entry);
      const filePath = validGitPath(requested.path, 'file.path');
      const current = currentFiles.get(filePath);
      if (!current || requested.revision != null && requested.revision !== current.revision) return null;
      return current;
    });
    if (files.some((file) => file == null)) return { ...emptyPatchResult('error'), errorCode: 'stale-review' };
    const review = await this.#reviewDiff(root, { source, files, snapshotGeneration: summary.snapshotGeneration }, signal);
    if (review.type === 'stale-snapshot') return emptyPatchResult('error');
    const sections = files.map((entry) => {
      const file = objectValue(entry);
      return review.diffs[validGitPath(file.path, 'file.path')];
    });
    if (sections.some((entry) => entry?.type !== 'success')) return emptyPatchResult('error');
    const diff = joinApplicablePatches(sections.map((entry) => entry.diff));
    if (!diff) return emptyPatchResult('error');
    if (action === 'stage') return this.#applyPatch(root, { diff, atomic: true, allowBinary: true, target: 'staged' }, signal);
    if (action === 'unstage') return this.#applyPatch(root, { diff, atomic: true, allowBinary: true, revert: true, target: 'staged' }, signal);
    if (source !== 'staged') {
      return this.#applyPatch(root, { diff, atomic: true, allowBinary: true, revert: true, target: 'unstaged' }, signal);
    }
    const staged = await this.#applyPatch(root, { diff, atomic: true, allowBinary: true, revert: true, target: 'staged' }, signal);
    if (staged.status !== 'success') return staged;
    const unstaged = await this.#applyPatch(root, { diff, atomic: true, allowBinary: true, revert: true, target: 'unstaged' }, signal);
    return unstaged.status === 'success' ? unstaged : { ...unstaged, status: 'partial-success' };
  }

  async #applyChanges(root, params, signal) {
    const sourceHeadRef = await this.#validRevision(params.sourceHeadRef, 'sourceHeadRef');
    const sourceTreeRef = await this.#validRevision(params.sourceTreeRef, 'sourceTreeRef');
    const destinationHeadRef = await this.#validRevision(params.destinationHeadRef, 'destinationHeadRef');
    const mergeBase = await this.#run(root, ['merge-base', sourceHeadRef, destinationHeadRef], { signal, allowFailure: true });
    if (mergeBase.code !== 0 || !mergeBase.stdout.trim()) {
      return { status: 'command-error', execOutput: gitExecOutput(['merge-base', sourceHeadRef, destinationHeadRef], mergeBase) };
    }
    const diff = await this.#run(root, [
      'diff', '--no-ext-diff', '--no-textconv', '--color=never', '--src-prefix=a/', '--dst-prefix=b/',
      '--binary', mergeBase.stdout.trim(), sourceTreeRef,
    ], { signal, allowFailure: true });
    if (diff.code !== 0) return { status: 'command-error', execOutput: gitExecOutput(['diff', mergeBase.stdout.trim(), sourceTreeRef], diff) };
    if (!diff.stdout) return { status: 'success' };
    const applied = await this.#applyPatch(root, { diff: diff.stdout, atomic: false, allowBinary: true, target: 'unstaged' }, signal);
    if (applied.status === 'error') return { ...applied, status: 'command-error' };
    return applied.status === 'partial-success' ? applied : { status: 'success', appliedPaths: applied.appliedPaths };
  }

  async #reviewSearch(root, params, signal) {
    const source = String(params.source || 'branch');
    const query = String(params.query || '').trim();
    if (!isReviewSource(source)) return { type: 'error', source, query };
    if (!query) return { type: 'success', source, query, matches: [], totalMatches: 0, isCapped: false };
    const patch = await this.#reviewPatch(root, {
      ...params,
      source,
      includeUntrackedFiles: params.includeUntrackedFiles !== false,
    }, signal);
    if (patch.diff.type !== 'success') return { type: 'error', source, query };
    return { type: 'success', source, query, ...searchUnifiedDiff(patch.diff.unifiedDiff, query) };
  }

  async #trackedReviewDiff(root, params, file, signal) {
    const paths = [file.previousPath, file.path].filter(Boolean);
    const result = await this.#runReviewDiff(root, params, paths, signal);
    if (result.code !== 0) return reviewError('unknown');
    return {
      type: 'success',
      diff: result.stdout,
      diffBytes: Buffer.byteLength(result.stdout, 'utf8'),
    };
  }

  async #untrackedDiff(root, filePath, signal) {
    const safePath = validGitPath(filePath, 'file.path');
    const result = await this.#run(root, [
      '-c', 'diff.mnemonicPrefix=false',
      '-c', 'diff.noprefix=false',
      '-c', 'core.quotePath=false',
      'diff', '--no-ext-diff', '--no-textconv', '--color=never', '--src-prefix=a/', '--dst-prefix=b/',
      '--no-index', '--', '/dev/null', safePath,
    ], { signal, allowFailure: true });
    if (![0, 1].includes(result.code)) return reviewError('unknown');
    return { type: 'success', diff: result.stdout, diffBytes: Buffer.byteLength(result.stdout, 'utf8') };
  }

  async #runReviewDiff(root, params, paths, signal) {
    const args = await this.#reviewDiffCommand(root, params, signal);
    const safePaths = paths.slice(0, MAX_REVIEW_FILES).map((entry) => validGitPath(entry, 'pathspec'));
    return this.#run(root, [
      ...args,
      ...(params.hideWhitespace === true ? ['--ignore-all-space'] : []),
      '--full-index',
      '--find-renames',
      '--',
      ...safePaths,
    ], { signal, allowFailure: true });
  }

  async #reviewDiffCommand(root, params, signal) {
    const source = String(params.source || 'branch');
    const prefix = [
      '-c', 'diff.mnemonicPrefix=false',
      '-c', 'diff.noprefix=false',
      '-c', 'core.quotePath=false',
      'diff', '--no-ext-diff', '--no-textconv', '--color=never', '--src-prefix=a/', '--dst-prefix=b/',
    ];
    if (source === 'staged') return [...prefix, '--cached'];
    if (source === 'unstaged') return prefix;
    if (source === 'uncommitted') return [...prefix, await this.#headOrEmptyTree(root, signal)];
    if (source === 'commit') {
      const commit = await this.#validRevision(params.commitSha, 'commitSha');
      const parent = await this.#run(root, ['rev-parse', '--verify', `${commit}^`], { signal, allowFailure: true });
      return [...prefix, parent.code === 0 ? parent.stdout.trim() : EMPTY_TREE_SHA, commit];
    }
    if (source !== 'branch') throw workerError('CODEX_GIT_WORKER_REVIEW_SOURCE_INVALID', 'Review source is invalid.');
    const base = await this.#validRevision(params.baseBranch || (await this.#defaultBranch(root, signal)) || 'HEAD', 'baseBranch');
    const mergeBase = await this.#run(root, ['merge-base', 'HEAD', base], { signal, allowFailure: true });
    return [...prefix, mergeBase.code === 0 ? mergeBase.stdout.trim() : base];
  }

  async #headOrEmptyTree(root, signal) {
    const head = await this.#run(root, ['rev-parse', '--verify', 'HEAD'], { signal, allowFailure: true });
    return head.code === 0 ? 'HEAD' : EMPTY_TREE_SHA;
  }

  async #reviewSnapshotGeneration(root, signal) {
    const [head, status] = await Promise.all([
      this.#run(root, ['rev-parse', '--verify', 'HEAD'], { signal, allowFailure: true }),
      this.#run(root, ['status', '--porcelain=v2', '-z', '--untracked-files=all'], { signal }),
    ]);
    const signature = `${head.code === 0 ? head.stdout.trim() : EMPTY_TREE_SHA}\0${status.stdout}`;
    const current = this.reviewSnapshots.get(root);
    if (current?.signature === signature) return current.generation;
    const generation = this.nextReviewSnapshotGeneration;
    this.nextReviewSnapshotGeneration += 1;
    this.reviewSnapshots.set(root, { generation, signature });
    return generation;
  }

  async #reviewFileRevision(root, source, snapshotGeneration, file, indexOids) {
    const filePath = validGitPath(file.path, 'file.path');
    const fullPath = path.join(root, ...filePath.split('/'));
    const info = await lstat(fullPath).catch(() => null);
    const indexOid = indexOids.get(filePath) || 'missing';
    const diskIdentity = info ? `${info.size}:${Math.floor(info.mtimeMs)}:${info.mode}` : 'missing';
    return `${source}:${file.changeKind}:${file.previousPath || ''}:${filePath}:${snapshotGeneration}:${indexOid}:${diskIdentity}`;
  }

  async #untrackedPaths(root, signal) {
    const result = await this.#run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { signal });
    return result.stdout.split('\0')
      .filter((record) => record.startsWith('?? '))
      .map((record) => record.slice(3))
      .filter(Boolean);
  }

  async #searchBranches(root, params, signal) {
    const query = String(params.query || '').trim().toLowerCase();
    const result = await this.#run(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], { signal });
    const branches = [...new Set(result.stdout.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean))]
      .filter((entry) => !query || entry.toLowerCase().includes(query))
      .slice(0, 100);
    return { branches };
  }

  async #nearestAncestorBranch(root, params, signal) {
    for (const raw of Array.isArray(params.candidates) ? params.candidates.slice(0, 100) : []) {
      const candidate = await this.#validRevision(raw, 'candidate');
      const result = await this.#run(root, ['merge-base', '--is-ancestor', candidate, 'HEAD'], { signal, allowFailure: true });
      if (result.code === 0) return { branch: candidate };
    }
    return { branch: null };
  }

  async #statusSummary(root, params, signal) {
    const includeUntracked = params.includeUntrackedFiles !== false;
    const result = await this.#run(root, ['status', '--porcelain=v1', '-z', includeUntracked ? '--untracked-files=all' : '--untracked-files=no'], { signal });
    let stagedCount = 0;
    let unstagedCount = 0;
    let untrackedCount = 0;
    for (const record of result.stdout.split('\0').filter(Boolean)) {
      const index = record[0] || ' ';
      const worktree = record[1] || ' ';
      if (index === '?' && worktree === '?') untrackedCount += 1;
      else {
        if (index !== ' ') stagedCount += 1;
        if (worktree !== ' ') unstagedCount += 1;
      }
    }
    return { type: 'success', stagedCount, unstagedCount, untrackedCount: includeUntracked ? untrackedCount : null };
  }

  async #submodulePaths(root, signal) {
    const result = await this.#run(root, ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], {
      signal,
      allowFailure: true,
    });
    if (result.code !== 0) return { paths: [] };
    return {
      paths: result.stdout.split(/\r?\n/u)
        .map((line) => line.trim().split(/\s+/u).slice(1).join(' '))
        .filter(Boolean),
    };
  }

  async #gitOrigins(params, signal) {
    const dirs = Array.isArray(params.dirs) ? params.dirs.slice(0, 100) : [];
    const origins = [];
    for (const directory of dirs) {
      const repository = await this.#repository(directory, signal, { nullable: true });
      if (!repository) {
        origins.push(null);
        continue;
      }
      const remote = await this.#run(repository.root, ['remote', 'get-url', 'origin'], { signal, allowFailure: true });
      origins.push({
        root: repository.root,
        commonDir: repository.commonDir,
        originUrl: remote.code === 0 ? remote.stdout.trim() || null : null,
      });
    }
    return { origins };
  }

  async #configValue(root, params, signal) {
    const key = validConfigKey(params.key);
    const result = await this.#run(root, ['config', '--get', key], { signal, allowFailure: true });
    return { value: result.code === 0 ? result.stdout.replace(/\r?\n$/u, '') : null };
  }

  async #setConfigValue(root, params, signal) {
    const key = validConfigKey(params.key);
    const value = requiredString(params.value, 'value', 16_384);
    const scope = String(params.scope || 'local');
    if (!['local', 'worktree'].includes(scope)) throw workerError('CODEX_GIT_WORKER_SCOPE_INVALID', 'Only local and worktree Git config scopes are supported.');
    await this.#run(root, ['config', scope === 'worktree' ? '--worktree' : '--local', key, value], { signal });
    return { success: true };
  }

  async #listWorktrees(root, signal) {
    const result = await this.#run(root, ['worktree', 'list', '--porcelain'], { signal });
    const worktrees = [];
    let current = null;
    for (const line of result.stdout.split(/\r?\n/u)) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current);
        current = { path: line.slice('worktree '.length), branch: null, head: null, bare: false, detached: false, locked: false, prunable: false };
      } else if (current && line.startsWith('HEAD ')) current.head = line.slice(5);
      else if (current && line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//u, '');
      else if (current && line === 'bare') current.bare = true;
      else if (current && line === 'detached') current.detached = true;
      else if (current && line.startsWith('locked')) current.locked = true;
      else if (current && line.startsWith('prunable')) current.prunable = true;
    }
    if (current) worktrees.push(current);
    return { worktrees };
  }

  async #worktreeStatus(root, params, signal) {
    const manager = await this.#worktreeManager(root);
    const worktreePath = requiredString(params.path || params.worktreePath, 'path', 32_768);
    if (signal.aborted) throw abortError();
    return manager.status(worktreePath);
  }

  async #createWorktree(root, params, signal) {
    const manager = await this.#worktreeManager(root);
    const id = requiredString(params.id, 'id', 80);
    const branch = String(params.branch || '').trim();
    const baseRef = String(params.baseRef || 'HEAD').trim() || 'HEAD';
    if (signal.aborted) throw abortError();
    return manager.create({ id, branch, baseRef });
  }

  async #removeWorktree(root, params, signal) {
    const manager = await this.#worktreeManager(root);
    const worktreePath = requiredString(params.path || params.worktreePath, 'path', 32_768);
    if (signal.aborted) throw abortError();
    return manager.remove(worktreePath, { force: params.force === true });
  }

  async #pruneWorktrees(root, signal) {
    const manager = await this.#worktreeManager(root);
    if (signal.aborted) throw abortError();
    return manager.prune();
  }

  async #worktreeManager(root) {
    const manager = createGitWorktreeManager({
      repositoryRoot: root,
      worktreeRoot: this.worktreeRoot,
      gitCommand: this.gitCommand,
      spawnImpl: this.spawnImpl,
      maxOutputBytes: this.maxOutputBytes,
    });
    await manager.initialize();
    return manager;
  }

  async #commit(root, params, signal) {
    const message = requiredString(params.message, 'message', 64 * 1024).trim();
    if (!message) throw workerError('CODEX_GIT_WORKER_COMMIT_MESSAGE_REQUIRED', 'Commit message is required.');
    if (params.includeUnstaged === true) await this.#run(root, ['add', '-A'], { signal });
    const result = await this.#run(root, ['commit', '--no-gpg-sign', '-m', message], { signal, allowFailure: true });
    if (result.code !== 0) {
      const empty = (await this.#run(root, ['diff', '--cached', '--quiet', '--exit-code'], { signal, allowFailure: true })).code === 0;
      return { status: 'error', error: result.stderr || result.stdout || 'Failed to commit changes', ...(empty ? { errorType: 'nothing-to-commit' } : {}) };
    }
    const head = await this.#run(root, ['rev-parse', 'HEAD'], { signal });
    return { status: 'success', commitSha: head.stdout.trim() || null };
  }

  async #gitInit(params, signal) {
    const cwd = await this.#assertAllowedPath(params.cwd || this.workspaceRoot);
    const result = await this.#run(cwd, ['init'], { signal });
    return { success: true, output: result.stdout.trim() };
  }

  async #validBranch(root, value, signal) {
    const branch = requiredString(value, 'branch', 512);
    const result = await this.#run(root, ['check-ref-format', '--branch', branch], { signal, allowFailure: true });
    if (result.code !== 0) throw workerError('CODEX_GIT_WORKER_BRANCH_INVALID', 'Git branch name is invalid.');
    return branch;
  }

  async #validRevision(value, label) {
    const revision = requiredString(value, label, 512);
    if (revision.startsWith('-') || /[\0\r\n]/u.test(revision)) throw workerError('CODEX_GIT_WORKER_REVISION_INVALID', `${label} is invalid.`);
    return revision;
  }

  async #assertAllowedPath(value) {
    const raw = requiredString(value, 'path', 32_768);
    const requested = await realpath(path.resolve(raw)).catch(() => null);
    if (!requested) throw workerError('CODEX_GIT_WORKER_PATH_UNAVAILABLE', 'Requested Git path is unavailable.', 404);
    this.workspaceRealPath ||= await realpath(this.workspaceRoot).catch(() => this.workspaceRoot);
    const roots = [this.workspaceRealPath, ...(await this.#registeredWorktreeRoots())];
    if (!roots.some((root) => isPathInside(root, requested))) {
      throw workerError('CODEX_GIT_WORKER_PATH_OUTSIDE_WORKSPACE', 'Requested Git path is outside the active workspace.', 403);
    }
    return requested;
  }

  async #registeredWorktreeRoots() {
    const result = await this.#run(this.workspaceRoot, ['worktree', 'list', '--porcelain'], {
      allowFailure: true,
      validatePath: false,
    });
    if (result.code !== 0) return [];
    const roots = [];
    for (const line of result.stdout.split(/\r?\n/u)) {
      if (!line.startsWith('worktree ')) continue;
      const resolved = await realpath(line.slice('worktree '.length)).catch(() => null);
      if (resolved) roots.push(resolved);
    }
    return roots;
  }

  #run(cwd, args, { signal, allowFailure = false, validatePath = true, input } = {}) {
    const commandCwd = path.resolve(String(cwd || this.workspaceRoot));
    if (validatePath && !path.isAbsolute(commandCwd)) throw workerError('CODEX_GIT_WORKER_PATH_INVALID', 'Git command path must be absolute.');
    return runGit(this.spawnImpl, this.gitCommand, commandCwd, args, {
      signal,
      allowFailure,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      input,
    });
  }
}

function assertWorkerMessage(workerId, message) {
  if (workerId !== WORKER_ID || message?.workerId !== WORKER_ID) {
    throw workerError('CODEX_GIT_WORKER_ID_INVALID', 'Only the Codex git worker is available.', 404);
  }
  const encoded = JSON.stringify(message);
  if (!encoded || Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) throw workerError('CODEX_GIT_WORKER_MESSAGE_TOO_LARGE', 'Git worker message exceeds the size limit.', 413);
  if (message.type === 'worker-request-cancel') {
    if (!REQUEST_ID.test(String(message.id || ''))) throw workerError('CODEX_GIT_WORKER_REQUEST_ID_INVALID', 'Git worker cancellation id is invalid.');
    return;
  }
  const request = message.type === 'worker-request' ? message.request : null;
  if (!request || !REQUEST_ID.test(String(request.id || '')) || typeof request.method !== 'string' || !request.method) {
    throw workerError('CODEX_GIT_WORKER_REQUEST_INVALID', 'Git worker request is invalid.');
  }
  if (!READ_METHODS.has(request.method) && !CONTROL_METHODS.has(request.method) && !MUTATION_METHODS.has(request.method) && !['subscribe-live-query', 'recover-live-queries'].includes(request.method)) {
    throw workerError('CODEX_GIT_WORKER_METHOD_NOT_IMPLEMENTED', `Git worker method is not implemented: ${request.method}`, 501);
  }
  if (request.params != null && (typeof request.params !== 'object' || Array.isArray(request.params))) {
    throw workerError('CODEX_GIT_WORKER_PARAMS_INVALID', 'Git worker params must be an object.');
  }
}

function workerSuccess(request, value) {
  return {
    type: 'worker-response',
    workerId: WORKER_ID,
    response: {
      emittedAtMs: Date.now(),
      id: request.id,
      method: request.method,
      result: { type: 'ok', value },
    },
  };
}

function workerFailure(request, error) {
  return {
    type: 'worker-response',
    workerId: WORKER_ID,
    response: {
      emittedAtMs: Date.now(),
      id: request.id,
      method: request.method,
      result: {
        type: 'error',
        error: {
          code: error?.code || 'CODEX_GIT_WORKER_REQUEST_FAILED',
          message: String(error?.message || error),
        },
      },
    },
  };
}

function runGit(spawnImpl, command, cwd, args, { signal, allowFailure, timeoutMs, maxOutputBytes, input }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawnImpl(command, ['--no-pager', '-C', cwd, ...args], {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let exceeded = false;
    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)]);
      if (next.length > maxOutputBytes) {
        exceeded = true;
        child.kill();
        return next.subarray(0, maxOutputBytes);
      }
      return next;
    };
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input == null ? undefined : String(input));
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    timeout.unref?.();
    const finish = (error, code = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(abortError());
      if (error) return reject(error);
      const result = { code: Number(code), stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') };
      if (exceeded) return reject(workerError('CODEX_GIT_WORKER_OUTPUT_LIMIT', 'Git worker output exceeded the size limit.', 413));
      if (result.code !== 0 && !allowFailure) {
        return reject(workerError('CODEX_GIT_WORKER_COMMAND_FAILED', result.stderr.trim() || result.stdout.trim() || `Git exited with code ${result.code}.`, 409));
      }
      resolve(result);
    };
    child.once('error', (error) => finish(workerError('CODEX_GIT_WORKER_SPAWN_FAILED', error.message, 503)));
    child.once('close', (code) => finish(null, code));
  });
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseNumstat(stdout) {
  const files = [];
  for (const record of String(stdout || '').split('\0').filter(Boolean)) {
    const firstTab = record.indexOf('\t');
    const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const pathValue = record.slice(secondTab + 1);
    if (!pathValue) continue;
    const additionsValue = record.slice(0, firstTab);
    const deletionsValue = record.slice(firstTab + 1, secondTab);
    files.push({
      path: pathValue,
      previousPath: null,
      additions: additionsValue === '-' ? null : Number.parseInt(additionsValue, 10) || 0,
      deletions: deletionsValue === '-' ? null : Number.parseInt(deletionsValue, 10) || 0,
    });
  }
  return files;
}

function parseNameStatus(stdout) {
  const values = String(stdout || '').split('\0').filter(Boolean);
  const kinds = new Map();
  for (let index = 0; index < values.length;) {
    const status = values[index] || '';
    index += 1;
    const code = status[0] || 'M';
    if (code === 'R' || code === 'C') {
      const previousPath = values[index];
      const filePath = values[index + 1];
      index += 2;
      if (filePath) kinds.set(filePath, code === 'R' ? 'renamed' : 'copied');
      if (previousPath && !filePath) kinds.set(previousPath, 'modified');
      continue;
    }
    const filePath = values[index];
    index += 1;
    if (!filePath) continue;
    kinds.set(filePath, code === 'A' ? 'added' : code === 'D' ? 'deleted' : code === 'U' ? 'unmerged' : 'modified');
  }
  return kinds;
}

function parseIndexOids(stdout) {
  const oids = new Map();
  for (const record of String(stdout || '').split('\0').filter(Boolean)) {
    const match = /^\d{6} ([0-9a-f]{40,64}) 0\t(.*)$/su.exec(record);
    if (match?.[1] && match[2]) oids.set(match[2], match[1]);
  }
  return oids;
}

function isReviewSource(value) {
  return ['branch', 'commit', 'staged', 'uncommitted', 'unstaged'].includes(value);
}

function reviewDiffErrors(source, files) {
  return {
    source,
    diffs: Object.fromEntries(files.map((file) => [file.path, reviewError('unknown')])),
  };
}

function reviewError(type, details = {}) {
  return { type: 'error', error: { type, ...details } };
}

function emptyPatchResult(status) {
  return { status, appliedPaths: [], skippedPaths: [], conflictedPaths: [] };
}

function requiredPatch(value) {
  const patch = String(value ?? '');
  if (!patch || patch.includes('\0') || Buffer.byteLength(patch, 'utf8') > MAX_MESSAGE_BYTES) {
    throw workerError('CODEX_GIT_WORKER_PATCH_INVALID', 'Patch content is invalid.');
  }
  return patch;
}

function patchPaths(diff) {
  const paths = new Set();
  for (const line of String(diff || '').split(/\r?\n/u)) {
    if (!line.startsWith('diff --git ')) continue;
    const parsed = parseDiffHeader(line);
    if (!parsed) continue;
    if (parsed.oldPath !== '/dev/null') paths.add(parsed.oldPath);
    if (parsed.newPath !== '/dev/null') paths.add(parsed.newPath);
  }
  return [...paths];
}

function patchFailurePaths(stderr, candidates) {
  const output = String(stderr || '');
  const paths = new Set();
  for (const candidate of candidates) {
    const escaped = escapeRegExp(candidate);
    if (new RegExp(`(?:patch failed|error):\\s*${escaped}(?::|\\s|$)`, 'imu').test(output)) paths.add(candidate);
  }
  return [...paths];
}

function gitExecOutput(args, result) {
  const output = [String(result.stdout || '').trim(), String(result.stderr || '').trim()].filter(Boolean).join('\n');
  return { command: `git ${args.join(' ')}`, output };
}

function escapeRegExp(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}

function joinPatchSections(sections) {
  return sections.map((section) => String(section || '').trimEnd()).filter(Boolean).join('\n');
}

function joinApplicablePatches(sections) {
  return sections.map((section) => String(section || '')).filter((section) => section.trim().length > 0)
    .map((section) => section.endsWith('\n') ? section : `${section}\n`).join('');
}

function validGitPath(value, label) {
  const raw = requiredString(value, label, 32_768).replace(/\\/gu, '/');
  const normalized = path.posix.normalize(raw);
  if (path.isAbsolute(raw) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(raw)) {
    throw workerError('CODEX_GIT_WORKER_PATHSPEC_INVALID', `${label} must remain inside the repository.`);
  }
  return normalized.replace(/^\.\//u, '');
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

function searchUnifiedDiff(unifiedDiff, query) {
  const matches = [];
  const needle = query.toLowerCase();
  let currentPath = null;
  let hunkId = null;
  let hunkNumber = 0;
  let lineStart = 1;
  let lineEnd = 1;
  let offset = 0;
  let totalMatches = 0;
  let isCapped = false;
  const pushMatches = (text, pathValue, id, startLine, endLine, baseOffset = 0) => {
    const lower = text.toLowerCase();
    let cursor = 0;
    while (cursor < lower.length) {
      const start = lower.indexOf(needle, cursor);
      if (start < 0) break;
      const end = start + needle.length;
      totalMatches += 1;
      if (matches.length < MAX_REVIEW_SEARCH_MATCHES) {
        matches.push({
          path: pathValue,
          hunkId: id,
          lineStart: startLine,
          lineEnd: endLine,
          start: baseOffset + start,
          end: baseOffset + end,
          snippet: {
            before: text.slice(Math.max(0, start - 24), start),
            match: text.slice(start, end),
            after: text.slice(end, Math.min(text.length, end + 24)),
          },
        });
      } else {
        isCapped = true;
      }
      cursor = end;
    }
  };
  for (const line of String(unifiedDiff || '').split(/\r?\n/u)) {
    if (line.startsWith('diff --git ')) {
      const parsed = parseDiffHeader(line);
      currentPath = parsed?.newPath || null;
      hunkId = null;
      hunkNumber = 0;
      offset = 0;
      if (parsed && currentPath) {
        const displayPath = parsed.oldPath === parsed.newPath ? parsed.newPath : `${parsed.oldPath} -> ${parsed.newPath}`;
        pushMatches(displayPath, currentPath, 'path', 1, 1);
      }
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (hunk) {
      const deletionStart = Number(hunk[1]);
      const deletionCount = Number(hunk[2] || '1');
      const additionStart = Number(hunk[3]);
      const additionCount = Number(hunk[4] || '1');
      lineStart = Math.max(1, Math.min(deletionStart, additionStart));
      lineEnd = Math.max(lineStart, deletionStart + Math.max(0, deletionCount) - 1, additionStart + Math.max(0, additionCount) - 1);
      hunkId = String(hunkNumber);
      hunkNumber += 1;
      offset = 0;
      continue;
    }
    if (currentPath == null || hunkId == null || line.startsWith('+++') || line.startsWith('---')) continue;
    if ([' ', '+', '-'].includes(line[0])) {
      const text = line.slice(1);
      pushMatches(text, currentPath, hunkId, lineStart, lineEnd, offset);
      offset += text.length + 1;
    }
  }
  return { matches, totalMatches, isCapped };
}

function parseDiffHeader(line) {
  const value = line.slice('diff --git '.length);
  const separator = value.lastIndexOf(' b/');
  if (!value.startsWith('a/') || separator < 0) return null;
  return { oldPath: value.slice(2, separator), newPath: value.slice(separator + 3) };
}

function requiredString(value, label, maxLength = 4096) {
  const text = String(value ?? '');
  if (!text || text.length > maxLength || /[\0\r\n]/u.test(text) && label !== 'message' && label !== 'value') {
    throw workerError('CODEX_GIT_WORKER_VALUE_INVALID', `${label} is invalid.`);
  }
  return text;
}

function validConfigKey(value) {
  const key = requiredString(value, 'key', 512);
  if (!/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u.test(key)) {
    throw workerError('CODEX_GIT_WORKER_CONFIG_KEY_INVALID', 'Git config key is invalid.');
  }
  return key;
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function abortError() {
  const error = new Error('Git worker request was cancelled.');
  error.name = 'AbortError';
  error.code = 'CODEX_GIT_WORKER_CANCELLED';
  return error;
}

function workerError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export { CONTROL_METHODS, MUTATION_METHODS, READ_METHODS, WORKER_ID };
