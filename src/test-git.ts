import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import type { ChangedPath } from './test-selection.js';
import type { WorkflowConfig } from './workflow.js';

const maxBuffer = 32 * 1024 * 1024;

interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: string;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  for (const key of Object.keys(env)) {
    if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|CONFIG.*)$/iu.test(key)
      || /^GIT_TRACE/iu.test(key)) delete env[key];
  }
  return {
    ...env,
    GIT_TRACE: '0',
    GIT_TRACE2: '0',
    GIT_TRACE2_EVENT: '0',
    GIT_TRACE2_PERF: '0',
  };
}

function runGit(root: string, args: string[], allowed: readonly number[] = [0]): GitResult {
  const result = spawnSync('git', [
    '--no-optional-locks',
    '-c', 'core.fsmonitor=false',
    '-c', 'diff.external=',
    '-c', 'diff.trustExitCode=false',
    '-C', root,
    ...args,
  ], {
    encoding: 'buffer',
    env: gitEnvironment(),
    shell: false,
    maxBuffer,
  });
  const status = result.status;
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8').trim() : '';
  if (result.error || status === null || !allowed.includes(status)) {
    const detail = result.error?.message ?? (stderr || '종료 상태를 확인할 수 없습니다.');
    throw new Error(`Git 조회 실패 (${args[0] ?? 'unknown'}): ${detail}`);
  }
  return { status, stdout, stderr };
}

function textGit(root: string, args: string[], allowed: readonly number[] = [0]): string {
  return decodeGit(runGit(root, args, allowed).stdout, args[0] ?? 'output');
}

function nulFields(buffer: Buffer): string[] {
  const fields = decodeGit(buffer, 'NUL output').split('\0');
  if (fields.at(-1) === '') fields.pop();
  return fields;
}

function decodeGit(buffer: Buffer, source: string): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new Error(`Git ${source} 출력의 파일 이름이 UTF-8이 아니어서 안전하게 처리할 수 없습니다.`); }
}

function validateBaseRef(baseRef: string): void {
  if (!baseRef || baseRef.trim() !== baseRef || baseRef.startsWith('-') || baseRef === '@'
    || /[\s~^:?*[\\\p{Cc}]/u.test(baseRef) || baseRef.includes('..') || baseRef.includes('@{')
    || baseRef.endsWith('.') || baseRef.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw new Error(`비교 ref가 안전한 이름이 아닙니다: ${baseRef || '(empty)'}`);
  }
}

function nativeDirectory(path: string): string {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    const found = fs.lstatSync(current);
    if (found.isSymbolicLink() || !found.isDirectory()) throw new Error(`${current}: 링크가 아닌 실제 디렉터리를 지정하세요.`);
  }
  return fs.realpathSync.native(absolute);
}

export function testRepositoryRoot(target: string): string {
  if (!target) throw new Error('대상 경로를 지정하세요.');
  const actual = nativeDirectory(target);
  if (textGit(actual, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true') {
    throw new Error('일반 Git 작업 트리에서 실행하세요. bare 저장소는 지원하지 않습니다.');
  }
  const root = nativeDirectory(textGit(actual, ['rev-parse', '--show-toplevel']).trim());
  const within = relative(root, actual);
  if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) {
    throw new Error('대상 경로와 Git 루트가 일치하지 않습니다.');
  }
  return root;
}

function parseNameStatus(buffer: Buffer): ChangedPath[] {
  const fields = nulFields(buffer);
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const path = fields[index++];
    if (!status || path === undefined) throw new Error('Git diff의 NUL 구분 출력을 해석할 수 없습니다.');
    const code = status[0]!;
    if (code === 'R' || code === 'C') {
      const destination = fields[index++];
      if (destination === undefined) throw new Error('Git rename/copy 출력을 해석할 수 없습니다.');
      changes.push({ path: destination, status: code, previousPath: path });
    } else {
      changes.push({ path, status: code });
    }
  }
  return changes;
}

function parseStatus(buffer: Buffer): ChangedPath[] {
  const fields = nulFields(buffer);
  const changes: ChangedPath[] = [];
  for (let index = 0; index < fields.length;) {
    const field = fields[index++];
    if (!field || field.length < 4 || field[2] !== ' ') throw new Error('Git status의 NUL 구분 출력을 해석할 수 없습니다.');
    const xy = field.slice(0, 2);
    const path = field.slice(3);
    if (xy === '??') {
      changes.push({ path, status: '?' });
      continue;
    }
    if (xy.includes('R') || xy.includes('C')) {
      const previousPath = fields[index++];
      if (previousPath === undefined) throw new Error('Git status rename/copy 출력을 해석할 수 없습니다.');
      changes.push({ path, status: xy.includes('R') ? 'R' : 'C', previousPath });
      continue;
    }
    const code = xy[1] !== ' ' ? xy[1]! : xy[0]!;
    changes.push({ path, status: code });
  }
  return changes;
}

function rejectUnsupportedIndex(root: string): void {
  // Partial clones can lazily fetch missing objects during otherwise read-only diff/show calls.
  // Refuse them before inspecting objects, including on Git versions without --no-lazy-fetch.
  const partial = textGit(root, ['config', '--get', 'extensions.partialClone'], [0, 1]).trim();
  const promisors = textGit(root, ['config', '--bool', '--get-regexp', '^remote\\..*\\.promisor$'], [0, 1]);
  if (partial || promisors.split(/\r?\n/u).some((line) => line.endsWith(' true'))) {
    throw new Error('부분 복제(partial clone/promisor) 저장소는 자동 객체 다운로드를 막기 위해 지원하지 않습니다. 완전한 로컬 복사본에서 실행하세요.');
  }
  if (runGit(root, ['ls-files', '--unmerged', '-z']).stdout.length > 0) {
    throw new Error('병합 충돌이 남아 있어 변경 범위를 안전하게 분석할 수 없습니다.');
  }
  const stages = nulFields(runGit(root, ['ls-files', '--stage', '-z']).stdout);
  if (stages.some((entry) => entry.startsWith('160000 '))) {
    throw new Error('Git submodule이 포함된 저장소는 현재 test 분석 범위에서 지원하지 않습니다.');
  }
}

function uniqueChanges(changes: ChangedPath[]): ChangedPath[] {
  const seen = new Set<string>();
  return changes.filter((change) => {
    const key = `${change.status}\0${change.previousPath ?? ''}\0${change.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function readChanges(root: string, baseRef: string): {
  head: string;
  baseRef: string;
  baseCommit: string;
  mergeBase: string;
  changes: ChangedPath[];
  baseSettings: string | null;
} {
  const repository = testRepositoryRoot(root);
  validateBaseRef(baseRef);
  rejectUnsupportedIndex(repository);
  const head = textGit(repository, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const baseCommit = textGit(repository, ['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`]).trim();
  const mergeBase = textGit(repository, ['merge-base', '--', head, baseCommit]).trim();
  if (!mergeBase) throw new Error(`${baseRef}: HEAD와 공통 조상을 찾을 수 없습니다.`);
  const committed = parseNameStatus(runGit(repository, [
    'diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', `${mergeBase}..${head}`, '--',
  ]).stdout);
  const pending = parseStatus(runGit(repository, [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none',
  ]).stdout);
  const object = `${mergeBase}:settings.gradle`;
  const exists = runGit(repository, ['cat-file', '-e', object], [0, 1, 128]).status === 0;
  const baseSettings = exists ? textGit(repository, ['show', '--no-textconv', object]) : null;
  return { head, baseRef, baseCommit, mergeBase, changes: uniqueChanges([...committed, ...pending]), baseSettings };
}

function repositoryPath(root: string, portable: string): string {
  return join(root, ...portable.split('/'));
}

function inside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function overlaps(left: string, right: string): boolean {
  return inside(left, right) || inside(right, left);
}

function inspectArtifactPath(root: string, path: string): void {
  let current = parse(root).root;
  for (const part of relative(current, repositoryPath(root, path)).split(sep).filter(Boolean)) {
    const siblings = fs.readdirSync(current);
    if (!siblings.includes(part) && siblings.some((name) => name.toLowerCase() === part.toLowerCase())) {
      throw new Error(`${path}: 산출물 경로의 대소문자가 실제 디렉터리와 다릅니다.`);
    }
    current = join(current, part);
    let found: fs.Stats;
    try { found = fs.lstatSync(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (found.isSymbolicLink()) throw new Error(`${path}: 산출물 경로에 심볼릭 링크/junction을 사용할 수 없습니다.`);
    if (!found.isDirectory()) throw new Error(`${path}: 산출물 경로는 디렉터리여야 합니다.`);
  }
}

export function assertArtifactsDirectory(root: string, config: WorkflowConfig, currentModules: string[]): void {
  const repository = testRepositoryRoot(root);
  const artifact = config.artifactsDir.replace(/\/$/u, '');
  const protectedPaths = ['.gradle', 'build', ...currentModules.flatMap((module) => [module, `${module}/build`])];
  for (const path of protectedPaths) {
    if (overlaps(artifact.toLowerCase(), path.toLowerCase())) {
      throw new Error(`artifactsDir: ${path} 경로와 겹치지 않는 전용 디렉터리를 지정하세요.`);
    }
  }
  inspectArtifactPath(repository, artifact);
  const tracked = nulFields(runGit(repository, ['ls-files', '-z']).stdout);
  const collision = tracked.find((path) => inside(path.toLowerCase(), artifact.toLowerCase()));
  if (collision) throw new Error(`${config.artifactsDir}: 추적 중인 파일 ${collision}과 겹쳐 실행 기록을 안전하게 제외할 수 없습니다.`);
}

function hashFiles(root: string, paths: string[]): string {
  const hash = createHash('sha256');
  for (const path of [...paths].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))) {
    hash.update(path, 'utf8').update('\0');
    const parts = path.split('/');
    let current = root;
    let found: fs.Stats | undefined;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      try { found = fs.lstatSync(current); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { found = undefined; break; }
        throw error;
      }
      if (found.isSymbolicLink()) throw new Error(`${path}: 심볼릭 링크/junction을 통해 외부 내용을 코드 지문에 포함할 수 없습니다.`);
      if (index < parts.length - 1 && !found.isDirectory()) throw new Error(`${path}: 상위 경로가 디렉터리가 아니어서 코드 지문을 만들 수 없습니다.`);
    }
    if (!found) {
      hash.update('missing\0');
      continue;
    }
    if (!found.isFile()) throw new Error(`${path}: 일반 파일이 아니어서 코드 지문을 만들 수 없습니다.`);
    hash.update(`file:${found.mode & 0o777}\0`).update(fs.readFileSync(current)).update('\0');
  }
  return hash.digest('hex');
}

function ignoredOutput(path: string, config: WorkflowConfig, modules: string[]): boolean {
  if (inside(path, config.artifactsDir.replace(/\/$/u, ''))) return true;
  if (inside(path, '.gradle') || (!modules.includes('build') && inside(path, 'build'))) return true;
  return modules.some((module) => inside(path, `${module}/build`));
}

/** Removes only known, untracked generated files. Tracked and renamed paths always remain source input. */
export function filterSourceChanges(
  root: string,
  changes: ChangedPath[],
  config: WorkflowConfig,
  currentModules: string[],
): ChangedPath[] {
  assertArtifactsDirectory(root, config, currentModules);
  return changes.filter((change) => change.status !== '?' || !ignoredOutput(change.path, config, currentModules));
}

export interface CodeFingerprint {
  digest: string;
  head: string;
  index: string;
  worktree: string;
  config: string;
}

export function fingerprintCode(root: string, config: WorkflowConfig, currentModules: string[], baseRef?: string): CodeFingerprint {
  const repository = testRepositoryRoot(root);
  assertArtifactsDirectory(repository, config, currentModules);
  rejectUnsupportedIndex(repository);
  const head = textGit(repository, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  const index = createHash('sha256').update(runGit(repository, ['ls-files', '--stage', '-z']).stdout).digest('hex');
  const tracked = nulFields(runGit(repository, ['ls-files', '-z']).stdout);
  const untracked = nulFields(runGit(repository, ['ls-files', '--others', '--exclude-standard', '-z']).stdout)
    .filter((path) => !ignoredOutput(path, config, currentModules));
  const worktree = hashFiles(repository, [...new Set([...tracked, ...untracked])]);
  const configHash = createHash('sha256').update(JSON.stringify({ config, currentModules, baseRef: baseRef ?? config.baseRef })).digest('hex');
  const digest = createHash('sha256').update(`${head}\0${index}\0${worktree}\0${configHash}`).digest('hex');
  return { digest, head, index, worktree, config: configHash };
}
