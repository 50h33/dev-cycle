import * as fs from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseWorkflowConfig } from './workflow.js';
import type { WorkflowConfig } from './workflow.js';
import { assertArtifactsDirectory, testRepositoryRoot } from './test-git.js';
import { checkTestRunFreshness, currentModules, readTestRun } from './test.js';
import type { TestResult } from './test.js';

export interface ReportOptions {
  cwd?: string;
  target?: string;
  configPath?: string;
  runId?: string;
  outputPath?: string;
  dryRun?: boolean;
}

export interface ReportResult {
  schemaVersion: 1;
  command: 'report';
  status: 'generated' | 'not-run' | 'failed';
  dryRun: boolean;
  root: string | null;
  run: TestResult | null;
  freshness: ReturnType<typeof checkTestRunFreshness> | null;
  markdown: string;
  outputPath: string | null;
  errors: string[];
  warnings: string[];
  exitCode: 0 | 2;
}

const runIdPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/u;
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Inspect every existing segment, including broken links, without following links. */
function inspectPath(root: string, path: string, file: boolean): boolean {
  const parts = relative(root, path).split(sep);
  if (isAbsolute(relative(root, path)) || parts.some((part) => !part || part === '..')) throw new Error('관리 경로 밖의 파일은 사용할 수 없습니다.');
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (stat.isSymbolicLink() || (index === parts.length - 1 && file ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`${current}: 링크가 아닌 ${index === parts.length - 1 && file ? '일반 파일' : '디렉터리'}가 필요합니다.`);
    }
  }
  return true;
}

function selectRun(root: string, config: WorkflowConfig, runId?: string): TestResult | null {
  if (runId !== undefined && !runIdPattern.test(runId)) throw new Error('--run-id는 기록의 UUID 형식이어야 합니다.');
  const directory = join(root, config.artifactsDir, 'runs');
  if (!inspectPath(root, directory, false)) {
    if (runId) throw new Error(`지정한 실행 기록이 없습니다: ${runId}`);
    return null;
  }
  const ids = runId ? [runId] : fs.readdirSync(directory);
  let latest: TestResult | null = null;
  for (const id of ids) {
    if (!runIdPattern.test(id)) throw new Error(`${id}: 알 수 없는 실행 디렉터리입니다. 기록을 확인하거나 --run-id를 지정하세요.`);
    const path = join(directory, id, 'record.json');
    if (!inspectPath(root, path, true)) throw new Error(`${id}: 실행 기록이 누락되었습니다. 과거 성공으로 대체하지 않습니다.`);
    let run: TestResult;
    try { run = readTestRun(path); }
    catch (error) { throw new Error(`${id}: ${message(error)}`, { cause: error }); }
    if (run.root !== root || run.artifactsDir !== config.artifactsDir || run.runId !== id) {
      throw new Error(`${id}: 다른 저장소 또는 다른 관리 경로의 실행 기록입니다.`);
    }
    if (!latest || Date.parse(run.startedAt!) > Date.parse(latest.startedAt!)
      || (Date.parse(run.startedAt!) === Date.parse(latest.startedAt!) && run.runId! > latest.runId!)) latest = run;
  }
  return latest;
}

/** Values from repositories and records are data, never Markdown/HTML instructions. */
function literal(value: string): string {
  return value.replace(/[\p{Cc}]/gu, (character) => JSON.stringify(character).slice(1, -1))
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~]/gu, '\\$&');
}

function renderReport(result: ReportResult): string {
  const lines = ['## 검증 기록', ''];
  const add = (label: string, value: string): void => { lines.push(`- ${label}: ${literal(value)}`); };
  if (!result.run) {
    add('테스트 상태', 'not-run (미실행)');
    lines.push('- 실제 실행 기록을 확인하지 못했습니다. 테스트를 실행하지 않았거나 기록을 읽을 수 없습니다.');
    lines.push('- 현재 코드를 검증하지 않았습니다. dry-run은 실제 실행 기록을 만들지 않습니다.');
  } else {
    const run = result.run;
    add('Run ID', run.runId!);
    add('테스트 상태', run.status);
    add('기록 위치', run.recordPath!);
    add('실행 시각', `${run.startedAt} → ${run.endedAt ?? '종료 기록 없음'}`);
    add('코드 신선도', `${result.freshness?.status ?? 'unknown'}: ${result.freshness?.reason ?? '현재 코드 비교를 완료하지 못했습니다.'}`);
    add('실행 전후 코드', run.codeState);
    if (result.freshness?.status !== 'current') lines.push('- **현재 코드를 검증하지 않았습니다. 과거 또는 불안정한 실행 결과입니다.**');
    else lines.push('- 기록 시점과 현재 코드 지문이 같습니다. 아래 실행 상태와 대상 범위 내의 결과만 확인하세요.');
    if (!run.execution?.started) lines.push('- 테스트 프로세스를 실행하지 않았습니다. 생략 또는 미실행은 통과가 아닙니다.');
    if (run.comparison) {
      add('실행 HEAD', run.comparison.head);
      add('비교 기준', `${run.comparison.baseRef} (${run.comparison.baseCommit}), merge-base ${run.comparison.mergeBase}`);
    }
    for (const [name, state] of [['실행 전', run.before], ['실행 후', run.after]] as const) {
      if (state) add(`${name} 지문`, `digest=${state.digest}, HEAD=${state.head}, index=${state.index}, worktree=${state.worktree}, config=${state.config}`);
    }
    if (run.selection) {
      add('선택', `${run.selection.mode}: ${run.selection.modules.join(', ') || '없음'}`);
      add('태스크', JSON.stringify(run.selection.tasks));
      for (const reason of run.selection.reasons) add('선정/생략 이유', reason);
      for (const path of run.selection.paths) add('변경 경로', `[${path.status}] ${path.previousPath ? `${path.previousPath} → ` : ''}${path.path}`);
    }
    if (run.invocation) {
      add('실행 파일', run.invocation.executable);
      add('인자(JSON)', JSON.stringify(run.invocation.args));
      add('실행 디렉터리', run.invocation.cwd);
    }
    add('test CLI 종료 코드', String(run.exitCode));
    if (run.execution) {
      add('프로세스 시작', String(run.execution.started));
      add('프로세스 종료 코드', String(run.execution.exitCode ?? '없음'));
      add('Signal', run.execution.signal ?? '없음');
      add('중단 요청', String(run.execution.interrupted));
      for (const task of run.execution.tasks) add('태스크 결과', `${task.task}: ${task.outcome}`);
      if (run.execution.error) add('프로세스 오류', run.execution.error);
      if (run.execution.cleanupError) add('프로세스 정리 오류', run.execution.cleanupError);
    }
    lines.push('- 프로세스 성공과 새 테스트 실행은 별도입니다. 캐시, UP-TO-DATE, NO-SOURCE는 새 테스트 통과가 아닙니다.');
    if (run.evidence?.counts) {
      const counts = run.evidence.counts;
      add('이번 실행 XML', `tests=${counts.tests}, failures=${counts.failures}, errors=${counts.errors}, skipped=${counts.skipped}`);
    } else lines.push('- 이번 실행의 테스트 수: 확인되지 않음');
    if (run.evidence?.hasFailures) lines.push('- 이번 실행 XML에서 실패를 확인했습니다.');
    for (const file of run.evidence?.files ?? []) add('XML 증거', `${file.path}: ${file.state}${file.copiedPath ? ` (보존: ${file.copiedPath})` : ''}`);
    for (const warning of run.warnings) add('실행 경고', warning);
    for (const error of run.errors) add('실행 오류', error);
  }
  for (const warning of result.warnings) add('보고서 경고', warning);
  for (const error of result.errors) add('보고서 오류', error);
  lines.push('', '실패 테스트 이름, 커버리지, 수동 시연과 원격 CI 결과는 이 기록에서 확인하지 않았습니다.',
    '로컬 실행 기록에 근거한 초안입니다. 원문 로그는 포함하지 않으며 GitHub에 게시하지 않습니다.', '');
  return lines.join('\n');
}

function outputDestination(root: string, config: WorkflowConfig, input: string): string {
  // Validate before resolve() erases traversal and Windows alias segments.
  const portable = input.replaceAll('\\', '/');
  const parts = portable.split('/');
  if (parts.some((part) => part === '.' || part === '..' || /[. ]$/u.test(part)
    || /^(?:(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)|con(?:in|out)\$$)/iu.test(part))
    || /[\p{Cc}*?"<>|]/u.test(input) || /:/u.test(isAbsolute(input) ? input.slice(2) : input)) {
    throw new Error('--output에 경로 이탈, 예약 이름 또는 지원하지 않는 문자가 있습니다.');
  }
  const requested = resolve(root, input);
  const reports = join(root, config.artifactsDir, 'reports');
  const rel = relative(reports, requested);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`--output은 ${config.artifactsDir}/reports/ 아래 파일이어야 합니다.`);
  }
  // Preserve configured artifact spelling on case-insensitive filesystems.
  const path = join(reports, rel);
  if (inspectPath(root, path, true)) throw new Error(`${path}: 기존 파일을 덮어쓰지 않습니다. 새 파일 이름을 지정하세요.`);
  return path;
}

function writeReport(root: string, path: string, render: () => string): void {
  let current = root;
  for (const part of relative(root, dirname(path)).split(sep)) {
    current = join(current, part);
    try { fs.mkdirSync(current, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      inspectPath(root, current, false);
    }
  }
  inspectPath(root, path, true);
  fs.writeFileSync(path, render(), { flag: 'wx', mode: 0o600 });
}

/** Reads actual local evidence; never runs tests, fetches Git refs or publishes to GitHub. */
export function runReport(options: ReportOptions = {}): ReportResult {
  const result: ReportResult = {
    schemaVersion: 1, command: 'report', status: 'not-run', dryRun: options.dryRun ?? false,
    root: null, run: null, freshness: null, markdown: '', outputPath: null, errors: [], warnings: [], exitCode: 0,
  };
  try {
    for (const key of ['cwd', 'target', 'configPath', 'runId', 'outputPath'] as const) {
      if (options[key] === '') throw new Error(`${key}: 빈 값을 지정할 수 없습니다.`);
    }
    const cwd = resolve(options.cwd ?? process.cwd());
    const root = testRepositoryRoot(resolve(cwd, options.target ?? '.'));
    result.root = root;
    const configPath = resolve(options.configPath === undefined ? root : cwd, options.configPath ?? 'dev-cycle.config.json');
    const config = parseWorkflowConfig(JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/u, '')) as unknown);
    assertArtifactsDirectory(root, config, []);
    const run = selectRun(root, config, options.runId);
    result.run = run;
    if (run) {
      result.status = 'generated';
      if (options.runId) result.warnings.push('명시적으로 지정한 실행입니다. 최신 실행 여부를 보장하지 않습니다.');
    }
    if (options.outputPath !== undefined) {
      // Do not write into an adapter source module, even when current analysis is unsupported.
      const settings = join(root, 'settings.gradle');
      const modules = fs.existsSync(settings) || fs.existsSync(join(root, 'settings.gradle.kts')) ? currentModules(root) : [];
      assertArtifactsDirectory(root, config, modules);
      const output = outputDestination(root, config, options.outputPath);
      result.outputPath = output;
    }
    if (result.dryRun) result.warnings.push('dry-run: 보고서 파일과 디렉터리를 생성하지 않았습니다.');
    const render = (): string => {
      if (run) result.freshness = checkTestRunFreshness({ ...run, configPath });
      result.markdown = renderReport(result);
      return result.markdown;
    };
    if (result.outputPath && !result.dryRun) writeReport(root, result.outputPath, render);
    else render();
  } catch (error) {
    result.status = 'failed'; result.exitCode = 2;
    result.errors.push(message(error));
    result.markdown = renderReport(result);
  }
  return result;
}
