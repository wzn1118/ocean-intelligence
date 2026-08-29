import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const BRANCH_PATTERN = /^(?![-.])(?!.*(?:\.\.|\s))(?!.*[~^:?*\\[\]{}])[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;

export class GitWorktreeError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'GitWorktreeError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

/**
 * A shell-free Git worktree adapter. The caller owns persistence and lease
 * policy; this class is deliberately limited to Git commands and containment
 * of worktree directories below a configured root.
 */
export class GitWorktreeManager {
  constructor({ repositoryRoot, worktreeRoot, gitCommand = 'git', spawnImpl = spawn, maxOutputBytes = 256 * 1024 } = {}) {
    if (!repositoryRoot || !worktreeRoot) throw new TypeError('repositoryRoot and worktreeRoot are required.');
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.worktreeRoot = path.resolve(worktreeRoot);
    this.gitCommand = String(gitCommand || 'git');
    this.spawnImpl = spawnImpl;
    this.maxOutputBytes = Math.max(1024, Number(maxOutputBytes) || 256 * 1024);
  }

  async initialize() {
    await mkdir(this.worktreeRoot, { recursive: true });
    const root = await realpath(this.repositoryRoot).catch(() => {
      throw new GitWorktreeError('WORKTREE_REPOSITORY_NOT_FOUND', 'The project repository directory does not exist.', 404);
    });
    const worktrees = await realpath(this.worktreeRoot);
    this.repositoryRoot = root;
    this.worktreeRoot = worktrees;
    await this.#git(['rev-parse', '--is-inside-work-tree']);
    return this.describe();
  }

  describe() {
    return {
      repositoryRoot: this.repositoryRoot,
      worktreeRoot: this.worktreeRoot,
      gitCommand: this.gitCommand,
    };
  }

  async list() {
    const { stdout } = await this.#git(['worktree', 'list', '--porcelain']);
    return Promise.all(parsePorcelainWorktrees(stdout).map(async (entry) => {
      const canonicalPath = await realpath(entry.path).catch(() => path.resolve(entry.path));
      return {
        ...entry,
        path: canonicalPath,
        managed: isPathInside(this.worktreeRoot, canonicalPath),
      };
    }));
  }

  async create({ id = `worktree-${randomUUID()}`, branch = '', baseRef = 'HEAD' } = {}) {
    const safeId = requiredId(id, 'worktree ID');
    const safeBaseRef = requiredGitRef(baseRef, 'baseRef');
    const targetPath = resolveContainedPath(this.worktreeRoot, safeId);
    if (existsSync(targetPath)) {
      throw new GitWorktreeError('WORKTREE_PATH_EXISTS', `A worktree path already exists for ${safeId}.`, 409);
    }
    const normalizedBranch = String(branch || '').trim();
    const args = normalizedBranch
      ? ['worktree', 'add', '-b', requiredGitRef(normalizedBranch, 'branch'), targetPath, safeBaseRef]
      : ['worktree', 'add', '--detach', targetPath, safeBaseRef];
    await this.#git(args);
    const resolved = await realpath(targetPath).catch(() => {
      throw new GitWorktreeError('WORKTREE_CREATE_FAILED', 'Git did not create the requested worktree.', 502);
    });
    if (!isPathInside(this.worktreeRoot, resolved)) {
      throw new GitWorktreeError('WORKTREE_PATH_ESCAPE', 'Git created a worktree outside the configured worktree root.', 500);
    }
    const entries = await this.list();
    const entry = entries.find((candidate) => samePath(candidate.path, resolved));
    return {
      id: safeId,
      path: resolved,
      branch: entry?.branch || normalizedBranch || null,
      head: entry?.head || null,
      detached: entry?.detached ?? !normalizedBranch,
      locked: entry?.locked ?? false,
    };
  }

  async status(worktreePath) {
    const resolved = await this.#resolveManagedPath(worktreePath);
    const [{ stdout: branch }, { stdout: revision }, { stdout: porcelain }] = await Promise.all([
      this.#git(['-C', resolved, 'branch', '--show-current']),
      this.#git(['-C', resolved, 'rev-parse', 'HEAD']),
      this.#git(['-C', resolved, 'status', '--porcelain=v1']),
    ]);
    return {
      path: resolved,
      branch: branch.trim() || null,
      revision: revision.trim(),
      dirty: Boolean(porcelain.trim()),
      changes: porcelain.trim().split(/\r?\n/).filter(Boolean).slice(0, 500),
    };
  }

  async diff(worktreePath, { baseRef = 'HEAD', maxBytes = this.maxOutputBytes } = {}) {
    const resolved = await this.#resolveManagedPath(worktreePath);
    const { stdout, truncated } = await this.#git(['-C', resolved, 'diff', '--no-ext-diff', '--binary', requiredGitRef(baseRef, 'baseRef')], {
      maxOutputBytes: boundedBytes(maxBytes, this.maxOutputBytes),
    });
    return { path: resolved, baseRef, diff: stdout, truncated };
  }

  async remove(worktreePath, { force = false } = {}) {
    const resolved = await this.#resolveManagedPath(worktreePath);
    await this.#git(['worktree', 'remove', ...(force ? ['--force'] : []), resolved]);
    return { path: resolved, removed: true };
  }

  async prune() {
    await this.#git(['worktree', 'prune']);
    return { pruned: true };
  }

  async #resolveManagedPath(worktreePath) {
    const value = String(worktreePath || '').trim();
    if (!value) throw new GitWorktreeError('WORKTREE_PATH_REQUIRED', 'A worktree path is required.', 400);
    const resolved = await realpath(path.resolve(value)).catch(() => {
      throw new GitWorktreeError('WORKTREE_NOT_FOUND', 'The requested worktree does not exist.', 404);
    });
    if (!isPathInside(this.worktreeRoot, resolved)) {
      throw new GitWorktreeError('WORKTREE_PATH_ESCAPE', 'The worktree is outside the managed worktree root.', 403);
    }
    return resolved;
  }

  #git(args, { maxOutputBytes = this.maxOutputBytes } = {}) {
    return runCommand(this.spawnImpl, this.gitCommand, args, {
      cwd: this.repositoryRoot,
      maxOutputBytes,
    });
  }
}

export function createGitWorktreeManager(options) {
  return new GitWorktreeManager(options);
}

function runCommand(spawnImpl, command, args, { cwd, maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(commandError(error));
      return;
    }
    let stdout = '';
    let stderr = '';
    let truncated = false;
    const append = (current, chunk) => {
      const next = `${current}${chunk}`;
      if (Buffer.byteLength(next) <= maxOutputBytes) return next;
      truncated = true;
      return Buffer.from(next).subarray(0, maxOutputBytes).toString('utf8');
    };
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk.toString('utf8')); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk.toString('utf8')); });
    child.once('error', (error) => reject(commandError(error)));
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr, truncated });
        return;
      }
      reject(new GitWorktreeError(
        'WORKTREE_GIT_COMMAND_FAILED',
        `Git command failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
        502,
        { command, args: [...args], code, signal, stderr: stderr.slice(0, 4_000), truncated },
      ));
    });
  });
}

function parsePorcelainWorktrees(value) {
  const entries = [];
  let current = null;
  for (const rawLine of String(value || '').split(/\r?\n/)) {
    if (!rawLine) {
      if (current?.path) entries.push(current);
      current = null;
      continue;
    }
    const [key, ...rest] = rawLine.split(' ');
    const payload = rest.join(' ');
    if (key === 'worktree') {
      if (current?.path) entries.push(current);
      current = { path: payload, branch: null, head: null, detached: false, locked: false };
    } else if (current && key === 'HEAD') current.head = payload;
    else if (current && key === 'branch') current.branch = payload.replace(/^refs\/heads\//, '');
    else if (current && key === 'detached') current.detached = true;
    else if (current && key === 'locked') current.locked = true;
  }
  if (current?.path) entries.push(current);
  return entries;
}

function requiredId(value, label) {
  const normalized = String(value || '').trim();
  if (!ID_PATTERN.test(normalized)) {
    throw new GitWorktreeError('WORKTREE_ID_INVALID', `${label} must use letters, digits, dashes, or underscores.`, 400);
  }
  return normalized;
}

function requiredGitRef(value, label) {
  const normalized = String(value || '').trim();
  if (!BRANCH_PATTERN.test(normalized) || normalized.includes('//') || normalized.endsWith('.lock')) {
    throw new GitWorktreeError('WORKTREE_REF_INVALID', `${label} is not a valid Git ref.`, 400);
  }
  return normalized;
}

function resolveContainedPath(root, child) {
  const resolved = path.resolve(root, child);
  if (!isPathInside(root, resolved)) {
    throw new GitWorktreeError('WORKTREE_PATH_ESCAPE', 'The requested worktree path escapes the managed root.', 403);
  }
  return resolved;
}

function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function boundedBytes(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? Math.max(1024, Math.min(fallback, numeric)) : fallback;
}

function commandError(error) {
  return new GitWorktreeError(
    'WORKTREE_GIT_UNAVAILABLE',
    'Git could not be started for the requested worktree operation.',
    503,
    { code: error?.code || 'GIT_SPAWN_FAILED' },
  );
}
