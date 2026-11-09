import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseWorkflowConfig } from './workflow.js';
import { parseGradleSettings, selectTests } from './test-selection.js';
import type { TestSelection } from './test-selection.js';
import { assertArtifactsDirectory, filterSourceChanges, fingerprintCode, readChanges, testRepositoryRoot } from './test-git.js';
import type { CodeFingerprint } from './test-git.js';
import { collectTestEvidence, executeTestCommand, prepareTestCommand, snapshotTestEvidence } from './test-process.js';
import type { ProcessExecution, TestCommand, TestEvidence } from './test-process.js';

export interface TestOptions {
  cwd?: string;
  target?: string;
  configPath?: string;
  baseRef?: string;
  dryRun?: boolean;
  signal?: AbortSignal;
}

/** Version 1 is also the persisted run contract consumed by the report command. */
export interface TestResult {
  schemaVersion: 1;
  command: 'test';
  dryRun: boolean;
  status: 'not-run' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'skipped';
  analysis: 'complete' | 'error';
  root: string | null;
  artifactsDir: string | null;
  configPath: string | null;
  runId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  recordPath: string | null;
  comparison: { head: string; baseRef: string; baseCommit: string; mergeBase: string } | null;
  selection: TestSelection | null;
  invocation: TestCommand | null;
  before: CodeFingerprint | null;
  after: CodeFingerprint | null;
  codeState: 'unchanged' | 'changed' | 'unknown';
  execution: ProcessExecution | null;
  evidence: TestEvidence | null;
  errors: string[];
  warnings: string[];
  /** CLI status: 0 valid preview/skip/process success, 1 process/test failure, 2 input/I/O/start failure, 130 interrupted. */
  exitCode: 0 | 1 | 2 | 130;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function readConfig(path: string) {
  return parseWorkflowConfig(JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/u, '')) as unknown);
}

export function currentModules(root: string): string[] {
  if (fs.existsSync(join(root, 'settings.gradle.kts'))) throw new Error('settings.gradle.kts는 지원하지 않습니다. 정적 Groovy settings.gradle이 필요합니다.');
  const path = join(root, 'settings.gradle');
  if (!fs.lstatSync(path).isFile()) throw new Error('settings.gradle은 링크가 아닌 일반 파일이어야 합니다.');
  const modules = parseGradleSettings(fs.readFileSync(path, 'utf8'));
  const entries = fs.readdirSync(root);
  for (const module of modules) {
    if (!entries.includes(module)) throw new Error(`${module}: 실제 디렉터리와 settings.gradle 모듈의 대소문자가 일치해야 합니다.`);
    const directory = fs.lstatSync(join(root, module));
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error(`${module}: settings.gradle의 모듈은 링크가 아닌 실제 디렉터리여야 합니다.`);
  }
  return modules;
}

function createRunDirectory(root: string, artifactsDir: string, runId: string): string {
  let directory = root;
  for (const part of [...artifactsDir.split('/'), 'runs', runId]) {
    directory = join(directory, part);
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || part === runId) throw error;
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${directory}: 기록 경로에 링크나 일반 파일이 있습니다.`, { cause: error });
    }
  }
  return directory;
}

function saveRun(result: TestResult): void {
  if (!result.recordPath) return;
  const temporary = `${result.recordPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, result.recordPath);
}

export async function runTest(options: TestOptions = {}): Promise<TestResult> {
  const result: TestResult = {
    schemaVersion: 1, command: 'test', dryRun: options.dryRun ?? false, status: 'not-run', analysis: 'error',
    root: null, artifactsDir: null, configPath: null, runId: null, startedAt: null, endedAt: null, recordPath: null,
    comparison: null, selection: null, invocation: null, before: null, after: null, codeState: 'unknown',
    execution: null, evidence: null, errors: [], warnings: [], exitCode: 2,
  };
  try {
    for (const key of ['cwd', 'target', 'configPath', 'baseRef'] as const) {
      if (options[key] === '') throw new Error(`${key}: 빈 값을 지정할 수 없습니다.`);
    }
    const cwd = resolve(options.cwd ?? process.cwd());
    const root = testRepositoryRoot(resolve(cwd, options.target ?? '.'));
    result.root = root;
    result.configPath = resolve(options.configPath === undefined ? root : cwd, options.configPath ?? 'dev-cycle.config.json');
    const sourceConfig = readConfig(result.configPath);
    const config = { ...sourceConfig };
    result.artifactsDir = config.artifactsDir;
    if (options.baseRef !== undefined) config.baseRef = parseWorkflowConfig({ ...config, baseRef: options.baseRef }).baseRef;
    const modules = currentModules(root);
    assertArtifactsDirectory(root, config, modules);
    const planningState = fingerprintCode(root, sourceConfig, modules, config.baseRef);
    const changes = readChanges(root, config.baseRef);
    result.comparison = { head: changes.head, baseRef: changes.baseRef, baseCommit: changes.baseCommit, mergeBase: changes.mergeBase };
    const baseModules = changes.baseSettings === null ? [] : parseGradleSettings(changes.baseSettings);
    const sourceChanges = filterSourceChanges(root, changes.changes, config, modules);
    result.selection = selectTests(sourceChanges, modules, baseModules, config);
    result.invocation = result.selection.mode === 'skip' ? null : prepareTestCommand(root, config, result.selection.tasks);
    result.before = fingerprintCode(root, readConfig(result.configPath), currentModules(root), config.baseRef);
    const confirmed = readChanges(root, config.baseRef);
    if (planningState.digest !== result.before.digest || changes.head !== result.before.head || confirmed.head !== changes.head
      || confirmed.baseCommit !== changes.baseCommit || confirmed.mergeBase !== changes.mergeBase) {
      throw new Error('변경 분석 중 코드 또는 설정이 바뀌었습니다. 안정된 상태에서 다시 실행하세요.');
    }
    result.analysis = 'complete';
    result.exitCode = 0;
    if (result.dryRun) return result;
    if (options.signal?.aborted) {
      result.status = 'interrupted';
      result.exitCode = 130;
      result.warnings.push('실행 전 취소되었습니다. 프로세스나 기록을 생성하지 않았습니다.');
      return result;
    }

    // Inspect pre-existing evidence before creating records. No Gradle or filesystem changes in dry-run.
    const previousEvidence = result.invocation ? snapshotTestEvidence(root, modules) : null;
    result.runId = randomUUID();
    const directory = createRunDirectory(root, config.artifactsDir, result.runId);
    result.recordPath = join(directory, 'record.json');
    result.startedAt = new Date().toISOString();
    result.status = result.invocation ? 'running' : 'skipped';
    saveRun(result);
    if (result.invocation && previousEvidence) {
      result.execution = await executeTestCommand(result.invocation, directory, options.signal);
      const execution = result.execution;
      if (execution.interrupted) { result.status = 'interrupted'; result.exitCode = 130; }
      else if (!execution.started || execution.error) { result.status = execution.started ? 'failed' : 'not-run'; result.exitCode = 2; }
      else if (execution.signal) { result.status = 'interrupted'; result.exitCode = 130; }
      else if (execution.exitCode !== 0) { result.status = 'failed'; result.exitCode = 1; }
      else result.status = 'succeeded';
      if (execution.error) result.errors.push(execution.error);
      if (execution.cleanupError) result.errors.push(execution.cleanupError);
      result.evidence = collectTestEvidence(root, modules, previousEvidence, execution, directory);
      result.warnings.push(...result.evidence.warnings);
      if (result.evidence.hasFailures && result.status === 'succeeded') {
        result.status = 'failed'; result.exitCode = 1;
        result.errors.push('프로세스는 0으로 종료했지만 이번 실행의 XML에 테스트 실패가 있습니다.');
      }
    }
    result.after = fingerprintCode(root, readConfig(result.configPath), currentModules(root), config.baseRef);
    const afterComparison = readChanges(root, config.baseRef);
    result.codeState = result.before.digest === result.after.digest && afterComparison.baseCommit === changes.baseCommit
      && afterComparison.mergeBase === changes.mergeBase ? 'unchanged' : 'changed';
    if (result.codeState === 'changed') result.warnings.push('실행 전후 코드 또는 설정이 다릅니다. 현재 코드 전체를 검증한 결과로 사용하지 마세요.');
    result.endedAt = new Date().toISOString();
    saveRun(result);
  } catch (error) {
    result.errors.push(message(error));
    if (result.status !== 'interrupted') result.status = result.execution?.started || result.status === 'skipped' ? 'failed' : 'not-run';
    result.exitCode = result.status === 'interrupted' ? 130 : 2;
    result.endedAt = result.runId ? new Date().toISOString() : null;
    try { saveRun(result); } catch (recordError) { result.errors.push(`실행 기록 저장 실패: ${message(recordError)}`); }
  }
  return result;
}

function readConfigWithRef(result: TestResult) {
  if (!result.configPath || !result.comparison) throw new Error('기록에 설정 경로나 비교 기준이 없습니다.');
  return parseWorkflowConfig({ ...readConfig(result.configPath), baseRef: result.comparison.baseRef });
}

/** An unfinished journal is never repaired into success. This read does not mutate the record. */
export function readTestRun(path: string): TestResult {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as TestResult;
  if (!raw || raw.schemaVersion !== 1 || raw.command !== 'test' || !strings(raw.errors) || !strings(raw.warnings)
    || !['not-run', 'running', 'succeeded', 'failed', 'interrupted', 'skipped'].includes(raw.status)) {
    throw new Error('지원하지 않거나 잘못된 테스트 실행 기록입니다.');
  }
  validateRunRecord(raw, path);
  if (raw.endedAt === null) {
    return { ...raw, status: 'interrupted', codeState: 'unknown', exitCode: 130, warnings: [...raw.warnings, '종료 기록이 없는 미완료 실행입니다. 자동 성공 복구하지 않습니다.'] };
  }
  return raw;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateRunRecord(run: TestResult, path: string): void {
  const invalid = (): never => { throw new Error('테스트 실행 기록의 필드, 상태 또는 증거 경로가 잘못되었습니다.'); };
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('\0');
  const hash = (value: unknown): boolean => typeof value === 'string' && /^[a-f\d]{64}$/u.test(value);
  const commit = (value: unknown): boolean => typeof value === 'string' && /^[a-f\d]{40}(?:[a-f\d]{24})?$/u.test(value);
  const date = (value: unknown): boolean => text(value) && Number.isFinite(Date.parse(value));
  const portable = (value: unknown): value is string => text(value) && !isAbsolute(value)
    && !/[\\:*?"<>|\p{Cc}]/u.test(value)
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git' && !/[. ]$/u.test(part));
  const unfinished = run.endedAt === null && (run.status === 'running' || run.status === 'skipped');
  const within = (value: unknown, root: string): boolean => {
    if (!text(value)) return false;
    const rel = relative(root, resolve(root, value));
    return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (run.dryRun !== false || !text(run.root) || !isAbsolute(run.root) || !text(run.configPath) || !isAbsolute(run.configPath)
    || !portable(run.artifactsDir) || !text(run.recordPath) || resolve(run.recordPath) !== resolve(path) || !text(run.runId)
    || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/u.test(run.runId)
    || !date(run.startedAt) || (!unfinished && !date(run.endedAt)) || !['unchanged', 'changed', 'unknown'].includes(run.codeState)
    || !['complete', 'error'].includes(run.analysis) || ![0, 1, 2, 130].includes(run.exitCode)) invalid();
  if (resolve(run.root!, run.artifactsDir!, 'runs', run.runId!, 'record.json') !== resolve(path)) invalid();
  const directory = dirname(resolve(path));
  for (const state of [run.before, run.after]) {
    if (state !== null && (!object(state) || !commit(state.head) || ![state.digest, state.index, state.worktree, state.config].every(hash))) invalid();
  }
  if (run.comparison !== null && (!object(run.comparison) || !text(run.comparison.baseRef)
    || ![run.comparison.head, run.comparison.baseCommit, run.comparison.mergeBase].every(commit))) invalid();
  if (run.selection !== null && (!object(run.selection) || !['modules', 'all', 'skip'].includes(run.selection.mode)
    || !strings(run.selection.modules) || !strings(run.selection.tasks) || !strings(run.selection.reasons)
    || !Array.isArray(run.selection.paths) || !run.selection.paths.every((change) => object(change) && text(change.path)
      && text(change.status) && (change.previousPath === undefined || text(change.previousPath))))) invalid();
  if (run.invocation !== null && (!object(run.invocation) || !text(run.invocation.executable)
    || !strings(run.invocation.args) || run.invocation.cwd !== run.root)) invalid();
  const execution = run.execution;
  if (execution !== null) {
    if (!object(execution) || typeof execution.started !== 'boolean' || typeof execution.interrupted !== 'boolean'
      || !(execution.exitCode === null || Number.isInteger(execution.exitCode))
      || ![execution.signal, execution.error, execution.cleanupError].every((value) => value === null || typeof value === 'string')
      || !Array.isArray(execution.tasks) || !execution.tasks.every((task) => object(task) && text(task.task)
        && ['EXECUTED', 'FAILED', 'UP-TO-DATE', 'FROM-CACHE', 'NO-SOURCE', 'SKIPPED'].includes(task.outcome))) invalid();
    for (const log of [execution.stdout, execution.stderr]) {
      if (!object(log) || !within(log.path, directory) || !Number.isSafeInteger(log.bytes) || log.bytes < 0 || typeof log.truncated !== 'boolean') invalid();
    }
  }
  if (run.evidence !== null) {
    if (!object(run.evidence) || typeof run.evidence.hasFailures !== 'boolean' || !strings(run.evidence.warnings) || !Array.isArray(run.evidence.files)
      || !run.evidence.files.every((file) => object(file) && portable(file.path) && within(file.path, run.root!)
        && ['fresh', 'stale', 'untrusted'].includes(file.state)
        && (file.state !== 'fresh' || text(file.copiedPath))
        && (file.copiedPath === undefined || (portable(file.copiedPath)
          && within(resolve(directory, file.copiedPath), join(directory, 'evidence')))))) invalid();
    const counts = run.evidence.counts;
    if (counts !== null && (!object(counts) || ![counts.tests, counts.failures, counts.errors, counts.skipped].every((value) => Number.isSafeInteger(value) && value >= 0)
      || counts.failures + counts.errors + counts.skipped > counts.tests)) invalid();
    const fresh = run.evidence.files.some((file) => file.state === 'fresh');
    if (!execution || !run.invocation || !run.selection || run.selection.mode === 'skip') invalid();
    if ((fresh || counts !== null || run.evidence.hasFailures) && !execution!.started) invalid();
    if ((counts !== null || run.evidence.hasFailures) && !fresh) invalid();
    if (counts && (counts.failures + counts.errors > 0) !== run.evidence.hasFailures) invalid();
  }
  if (unfinished && (run.analysis !== 'complete' || run.exitCode !== 0 || !run.comparison || !run.selection || !run.before
    || run.after !== null || run.codeState !== 'unknown' || execution !== null || run.evidence !== null)) invalid();
  if (run.status === 'running' && (!unfinished || !run.invocation || run.selection?.mode === 'skip')) invalid();
  if (run.codeState === 'unchanged' && (!run.before || !run.after || run.before.digest !== run.after.digest)) invalid();
  if (run.status === 'succeeded' && (run.exitCode !== 0 || !execution?.started || execution.exitCode !== 0 || execution.signal !== null
    || execution.error !== null || execution.cleanupError !== null || execution.interrupted || !run.before || !run.after || run.codeState === 'unknown'
    || run.analysis !== 'complete' || !run.comparison || !run.selection || run.selection.mode === 'skip'
    || !run.invocation || !run.evidence || run.evidence.hasFailures)) invalid();
  if (run.status === 'skipped' && (run.exitCode !== 0 || run.analysis !== 'complete' || !run.comparison || !run.before || (!unfinished && !run.after)
    || execution !== null || run.invocation !== null || run.evidence !== null || run.selection?.mode !== 'skip')) invalid();
  if (run.status === 'interrupted' && (run.exitCode !== 130 || !execution || (!execution.interrupted && execution.signal === null))) invalid();
  if (run.status === 'not-run' && (run.exitCode !== 2 || execution?.started || run.errors.length === 0)) invalid();
  if (run.status === 'failed' && run.exitCode !== 1 && run.exitCode !== 2) invalid();
  if (run.status === 'failed' && run.exitCode === 1 && (!execution?.started || execution.interrupted || execution.signal !== null
    || execution.error !== null || ((execution.exitCode === null || execution.exitCode === 0) && !run.evidence?.hasFailures))) invalid();
  if (run.status === 'failed' && run.exitCode === 2 && run.errors.length === 0) invalid();
}

export function checkTestRunFreshness(result: TestResult): { status: 'current' | 'changed' | 'unknown' | 'incomplete'; reason: string } {
  if (!result.endedAt || result.status === 'running') return { status: 'incomplete', reason: '종료 기록이 없습니다.' };
  if (!result.root || !result.before || !result.after || !result.comparison || result.codeState === 'unknown') return { status: 'unknown', reason: '비교할 코드 상태가 없습니다.' };
  if (result.codeState === 'changed') return { status: 'changed', reason: '테스트 실행 전후 코드가 다릅니다.' };
  try {
    const config = readConfigWithRef(result);
    const comparison = readChanges(result.root, config.baseRef);
    const current = fingerprintCode(result.root, readConfig(result.configPath!), currentModules(result.root), config.baseRef);
    const same = current.digest === result.after.digest && comparison.baseCommit === result.comparison.baseCommit && comparison.mergeBase === result.comparison.mergeBase;
    return { status: same ? 'current' : 'changed', reason: same ? '기록한 코드와 설정 지문이 현재 상태와 같습니다.' : '테스트 이후 코드, 설정 또는 비교 ref가 변경되었습니다.' };
  } catch (error) { return { status: 'unknown', reason: message(error) }; }
}
