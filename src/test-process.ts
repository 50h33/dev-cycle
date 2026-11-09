import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { WorkflowConfig } from './workflow.js';

const LOG_LIMIT = 1024 * 1024;
const XML_LIMIT = 4 * 1024 * 1024;
const XML_TOTAL_LIMIT = 32 * 1024 * 1024;
const XML_FILE_LIMIT = 1000;
const LINE_LIMIT = 64 * 1024;

export interface TestCommand {
  executable: string;
  args: string[];
  cwd: string;
  /** Prepared commands retain the wrapper path so execution can reject missing or linked files before writing logs. */
  wrapper?: string;
}

export interface ProcessExecution {
  started: boolean;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  interrupted: boolean;
  cleanupError: string | null;
  stdout: { path: string; bytes: number; truncated: boolean };
  stderr: { path: string; bytes: number; truncated: boolean };
  tasks: { task: string; outcome: string }[];
}

interface EvidenceFile {
  path: string;
  size: number;
  mtimeMs: number;
  digest: string;
}

export type EvidenceSnapshot = Record<string, EvidenceFile>;

export interface TestEvidence {
  files: { path: string; state: 'fresh' | 'stale' | 'untrusted'; copiedPath?: string }[];
  counts: { tests: number; failures: number; errors: number; skipped: number } | null;
  /** Retained even when another malformed suite prevents a complete aggregate. */
  hasFailures: boolean;
  warnings: string[];
}

const allowedOptions = /^(?:--console=plain|--no-daemon|--offline|--rerun-tasks|--stacktrace|--info|--warn|--refresh-dependencies|--warning-mode=(?:all|summary|none|fail))$/u;
const safeTask = /^(?:test|:[\p{L}\p{N}_.-]+:test)$/u;

function windowsUnsafe(value: string): boolean {
  return /["%!^&|<>()\r\n\0]/u.test(value);
}

function cmdQuote(value: string): string {
  return `"${value}"`;
}

export function prepareTestCommand(
  root: string,
  config: WorkflowConfig,
  tasks: string[],
  platform: NodeJS.Platform = process.platform,
): TestCommand {
  if (tasks.length === 0 || tasks.some((task) => !safeTask.test(task))) {
    throw new Error('실행할 Gradle test 태스크가 없거나 안전한 최상위 모듈 test 태스크가 아닙니다.');
  }
  if (new Set(tasks).size !== tasks.length) throw new Error('같은 Gradle test 태스크를 중복 실행할 수 없습니다.');
  const base = config.commands.test;
  if (!base) throw new Error('commands.test 설정이 없습니다.');
  const selected = platform === 'win32' ? (base.windows ?? base) : base;
  const expected = platform === 'win32' ? './gradlew.bat' : './gradlew';
  if (selected.executable.replaceAll('\\', '/') !== expected) {
    throw new Error(`commands.test.executable은 저장소 루트의 ${expected}만 지원합니다.`);
  }
  if (selected.args.filter((arg) => arg === 'test').length !== 1) {
    throw new Error('commands.test.args에는 교체할 test 태스크를 정확히 한 번 지정해야 합니다.');
  }
  for (const arg of selected.args) {
    if (arg !== 'test' && !allowedOptions.test(arg)) {
      throw new Error(`지원하지 않는 Gradle 테스트 인자입니다: ${arg}`);
    }
  }
  const args = selected.args.flatMap((arg) => arg === 'test' ? tasks : [arg]);
  if (!args.includes('--console=plain')) args.push('--console=plain');
  if (!args.includes('--no-daemon')) args.push('--no-daemon');
  const cwd = fs.realpathSync.native(resolve(root));
  const wrapper = join(cwd, platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (platform !== 'win32') return { executable: wrapper, args, cwd, wrapper };

  const values = [cwd, wrapper, ...args];
  if (values.some(windowsUnsafe)) {
    throw new Error('Windows 배치 실행 경로와 인자에는 cmd.exe 특수문자, 따옴표 또는 줄바꿈을 사용할 수 없습니다.');
  }
  // The quoting below is specific to cmd.exe, not an arbitrary inherited ComSpec interpreter.
  const comspec = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
  const commandLine = [wrapper, ...args].map(cmdQuote).join(' ');
  return { executable: comspec, args: ['/d', '/s', '/v:off', '/c', `"${commandLine}"`], cwd, wrapper };
}

function taskCollector(target: Map<string, string>, onLimit: () => void) {
  let pending = '';
  let exceeded = false;
  const decoder = new StringDecoder('utf8');
  return (chunk: Buffer, final = false): void => {
    pending += final ? decoder.end() : decoder.write(chunk);
    if (pending.length > LINE_LIMIT && !pending.includes('\n')) pending = pending.slice(-LINE_LIMIT);
    const lines = pending.split(/\r?\n/u);
    pending = final ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      const match = /^> Task (:[\p{L}\p{N}_.:-]+)(?: (UP-TO-DATE|FROM-CACHE|NO-SOURCE|SKIPPED|FAILED))?\s*$/u.exec(line);
      if (!match?.[1] || exceeded) continue;
      if (!target.has(match[1]) && target.size >= 1000) {
        exceeded = true;
        onLimit();
        continue;
      }
      target.set(match[1], match[2] ?? 'EXECUTED');
    }
  };
}

function blankExecution(runDirectory: string): ProcessExecution {
  return {
    started: false, exitCode: null, signal: null, error: null, interrupted: false, cleanupError: null,
    stdout: { path: join(runDirectory, 'stdout.log'), bytes: 0, truncated: false },
    stderr: { path: join(runDirectory, 'stderr.log'), bytes: 0, truncated: false }, tasks: [],
  };
}

export async function executeTestCommand(
  command: TestCommand,
  runDirectory: string,
  signal?: AbortSignal,
): Promise<ProcessExecution> {
  const result = blankExecution(runDirectory);
  if (signal?.aborted) {
    result.interrupted = true;
    result.error = '실행 전에 중단되었습니다.';
    return result;
  }
  if (command.wrapper) {
    try {
      const expected = resolve(command.cwd, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
      if (resolve(command.wrapper) !== expected) throw new Error('Wrapper 경로가 저장소 루트를 벗어났습니다.');
      const found = fs.lstatSync(command.wrapper);
      if (!found.isFile() || found.isSymbolicLink()) throw new Error('Gradle Wrapper는 링크가 아닌 일반 파일이어야 합니다.');
    } catch (error) {
      result.error = `Gradle Wrapper를 실행할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`;
      return result;
    }
  }
  let stdoutFd: number | undefined;
  let stderrFd: number | undefined;
  try {
    fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
    stdoutFd = fs.openSync(result.stdout.path, 'wx', 0o600);
    stderrFd = fs.openSync(result.stderr.path, 'wx', 0o600);
  } catch (error) {
    if (stdoutFd !== undefined) fs.closeSync(stdoutFd);
    result.error = `실행 로그를 준비할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`;
    return result;
  }
  const outcomes = new Map<string, string>();
  let stopForIo = (): void => {};
  const onTaskLimit = (): void => {
    result.error ??= 'Gradle task 결과가 1000개를 넘어 기록 한도를 초과했습니다.';
    stopForIo();
  };
  const collectStdout = taskCollector(outcomes, onTaskLimit);
  const collectStderr = taskCollector(outcomes, onTaskLimit);

  return await new Promise((resolvePromise) => {
    let child;
    try {
      const isCmd = process.platform === 'win32' && basename(command.executable).toLowerCase() === 'cmd.exe';
      child = spawn(command.executable, command.args, {
        cwd: command.cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true,
        windowsVerbatimArguments: isCmd, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      fs.closeSync(stdoutFd); fs.closeSync(stderrFd);
      result.error = error instanceof Error ? error.message : String(error);
      resolvePromise(result);
      return;
    }
    let terminating = false;
    let cleanup: Promise<void> = Promise.resolve();
    let logFailed = false;
    const write = (kind: 'stdout' | 'stderr', fd: number, chunk: Buffer): void => {
      result[kind].bytes += chunk.length;
      const already = Math.min(result[kind].bytes - chunk.length, LOG_LIMIT);
      const remaining = LOG_LIMIT - already;
      if (remaining > 0 && !logFailed) {
        try { fs.writeSync(fd, chunk.subarray(0, remaining)); }
        catch (error) {
          logFailed = true;
          result.error ??= `실행 로그 기록 실패: ${error instanceof Error ? error.message : String(error)}`;
          stopForIo();
        }
      }
      if (result[kind].bytes > LOG_LIMIT) result[kind].truncated = true;
      (kind === 'stdout' ? collectStdout : collectStderr)(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => write('stdout', stdoutFd, chunk));
    child.stderr.on('data', (chunk: Buffer) => write('stderr', stderrFd, chunk));
    child.once('spawn', () => {
      result.started = true;
      if (signal?.aborted) terminate(true);
    });
    child.once('error', (error) => { result.error = error.message; });

    const terminate = (interrupted: boolean): void => {
      if (interrupted) result.interrupted = true;
      if (!result.started || child.pid === undefined) return;
      if (terminating) return;
      terminating = true;
      if (process.platform === 'win32') {
        const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
        const killed = spawnSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 10_000 });
        if (killed.error || killed.status !== 0) {
          result.cleanupError = killed.error?.message ?? (killed.stderr.trim() || `taskkill 종료 코드 ${String(killed.status)}`);
          child.kill();
        }
      } else {
        const group = -child.pid;
        try { process.kill(group, 'SIGTERM'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') result.cleanupError = error instanceof Error ? error.message : String(error);
        }
        // Keep the CLI alive through escalation even when the wrapper exits first. A descendant
        // can ignore SIGTERM and keep running with closed/redirected stdio after the parent closes.
        cleanup = new Promise((done) => setTimeout(() => {
          try { process.kill(group, 'SIGKILL'); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') result.cleanupError = error instanceof Error ? error.message : String(error);
          }
          done();
        }, 1500));
      }
    };
    stopForIo = () => terminate(false);
    const abort = (): void => terminate(true);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('close', async (code, closeSignal) => {
      signal?.removeEventListener('abort', abort);
      collectStdout(Buffer.alloc(0), true);
      collectStderr(Buffer.alloc(0), true);
      await cleanup;
      fs.closeSync(stdoutFd); fs.closeSync(stderrFd);
      result.exitCode = result.started ? code : null;
      result.signal = closeSignal;
      result.tasks = [...outcomes].map(([task, outcome]) => ({ task, outcome }));
      resolvePromise(result);
    });
  });
}

function portable(path: string): string {
  return path.split(sep).join('/');
}

function testResultRoots(root: string, modules: string[]): string[] {
  if (modules.some((module) => !/^[\p{L}\p{N}_.-]+$/u.test(module) || module === '.' || module === '..')) {
    throw new Error('테스트 증거는 안전한 최상위 모듈 경로에서만 수집할 수 있습니다.');
  }
  return ['', ...modules].map((module) => join(root, module, 'build', 'test-results', 'test'));
}

function evidenceDirectoryExists(root: string, directory: string): boolean {
  const within = relative(root, directory);
  if (!within || within === '..' || within.startsWith(`..${sep}`)) throw new Error('테스트 증거 경로가 저장소를 벗어났습니다.');
  let current = root;
  for (const part of within.split(sep)) {
    current = join(current, part);
    let found: fs.Stats;
    try { found = fs.lstatSync(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    if (found.isSymbolicLink()) throw new Error(`${portable(relative(root, current))}: 테스트 증거 경로의 링크는 지원하지 않습니다.`);
    if (!found.isDirectory()) throw new Error(`${portable(relative(root, current))}: 테스트 증거 경로의 상위 항목이 디렉터리가 아닙니다.`);
  }
  return true;
}

function scanEvidence(root: string, modules: string[]): EvidenceSnapshot {
  const output: EvidenceSnapshot = {};
  let total = 0;
  let count = 0;
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const found = fs.lstatSync(path);
      if (found.isSymbolicLink()) throw new Error(`${portable(relative(root, path))}: 테스트 증거 경로의 링크는 지원하지 않습니다.`);
      if (found.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.xml')) continue;
      if (!found.isFile()) throw new Error(`${portable(relative(root, path))}: 일반 XML 파일이 아닙니다.`);
      count += 1; total += found.size;
      if (count > XML_FILE_LIMIT || found.size > XML_LIMIT || total > XML_TOTAL_LIMIT) throw new Error('테스트 XML 증거의 파일 수 또는 크기가 지원 한도를 넘었습니다.');
      const content = fs.readFileSync(path);
      const key = portable(relative(root, path));
      output[key] = { path: key, size: found.size, mtimeMs: found.mtimeMs, digest: createHash('sha256').update(content).digest('hex') };
    }
  };
  for (const directory of testResultRoots(root, modules)) {
    if (evidenceDirectoryExists(root, directory)) walk(directory);
  }
  return output;
}

export function snapshotTestEvidence(root: string, modules: string[]): EvidenceSnapshot {
  return scanEvidence(fs.realpathSync.native(resolve(root)), modules);
}

function taskForEvidence(path: string): string {
  return path.startsWith('build/test-results/test/') ? ':test' : `:${path.split('/')[0]!}:test`;
}

/** A bounded XML subset for Gradle's default reports. No DTD, namespaces, entity expansion or recovery. */
function suiteAttributes(input: string): Record<string, string> | null {
  const xml = input.replace(/^\uFEFF/u, '');
  for (const character of xml) {
    const code = character.codePointAt(0)!;
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 0xfffe || code === 0xffff
      || (code >= 0xd800 && code <= 0xdfff)) return null;
  }
  const validText = (value: string): boolean => {
    if (value.includes(']]>')) return false;
    const remainder = value.replace(/&(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);/gu, (entity) => {
      if (!entity.startsWith('&#')) return '';
      const number = entity.startsWith('&#x') ? Number.parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
      return number === 9 || number === 10 || number === 13 || (number >= 32 && number <= 0x10ffff
        && !(number >= 0xd800 && number <= 0xdfff) && number !== 0xfffe && number !== 0xffff) ? '' : '&';
    });
    return !remainder.includes('&');
  };
  let position = 0;
  let root: Record<string, string> | null = null;
  const stack: string[] = [];
  if (xml.startsWith('<?xml')) {
    const declaration = /^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?(?:\s+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>/u.exec(xml);
    if (!declaration) return null;
    position = declaration[0].length;
  }
  while (position < xml.length) {
    if (xml.startsWith('<!--', position)) {
      const end = xml.indexOf('-->', position + 4);
      if (end < 0 || xml.slice(position + 4, end).includes('--')) return null;
      position = end + 3;
    } else if (xml.startsWith('<![CDATA[', position)) {
      const end = xml.indexOf(']]>', position + 9);
      if (stack.length === 0 || end < 0) return null;
      position = end + 3;
    } else if (xml.startsWith('</', position)) {
      const closing = /^<\/([A-Za-z_][A-Za-z\d_.-]*)\s*>/u.exec(xml.slice(position));
      if (!closing || stack.pop() !== closing[1]) return null;
      position += closing[0].length;
    } else if (xml[position] === '<') {
      const opening = /^<([A-Za-z_][A-Za-z\d_.-]*)/u.exec(xml.slice(position));
      if (!opening) return null;
      const name = opening[1]!;
      const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
      position += opening[0].length;
      while (true) {
        const whitespace = /^[ \t\r\n]*/u.exec(xml.slice(position))![0];
        position += whitespace.length;
        if (xml.startsWith('/>', position) || xml[position] === '>') break;
        if (whitespace.length === 0) return null;
        const attribute = /^([A-Za-z_][A-Za-z\d_.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/u.exec(xml.slice(position));
        if (!attribute || Object.hasOwn(attributes, attribute[1]!)) return null;
        const value = attribute[2] ?? attribute[3]!;
        if (!validText(value)) return null;
        attributes[attribute[1]!] = value;
        position += attribute[0].length;
      }
      if (stack.length === 0) {
        if (root !== null || name !== 'testsuite') return null;
        root = attributes;
      } else if (name === 'testsuite') return null;
      if (xml.startsWith('/>', position)) position += 2;
      else { stack.push(name); position += 1; }
      if (stack.length > 128) return null;
    } else {
      const end = xml.indexOf('<', position);
      const value = xml.slice(position, end < 0 ? xml.length : end);
      if (!validText(value) || (stack.length === 0 && !/^[ \t\r\n]*$/u.test(value))) return null;
      position = end < 0 ? xml.length : end;
    }
  }
  return stack.length === 0 ? root : null;
}

function parseCounts(content: string): { tests: number; failures: number; errors: number; skipped: number } | null {
  const source = suiteAttributes(content);
  if (!source || !['tests', 'failures', 'errors', 'skipped'].every((key) => /^\d+$/u.test(source[key] ?? ''))) return null;
  const attrs = Object.fromEntries(['tests', 'failures', 'errors', 'skipped'].map((key) => [key, Number(source[key])])) as Record<string, number>;
  if (!['tests', 'failures', 'errors', 'skipped'].every((key) => Number.isSafeInteger(attrs[key]) && attrs[key]! >= 0)) return null;
  if (attrs.failures! + attrs.errors! + attrs.skipped! > attrs.tests!) return null;
  return { tests: attrs.tests!, failures: attrs.failures!, errors: attrs.errors!, skipped: attrs.skipped! };
}

export function collectTestEvidence(
  root: string,
  modules: string[],
  before: EvidenceSnapshot,
  execution: ProcessExecution,
  runDirectory: string,
): TestEvidence {
  const canonicalRoot = fs.realpathSync.native(resolve(root));
  const after = scanEvidence(canonicalRoot, modules);
  const outcomes = new Map(execution.tasks.map((item) => [item.task, item.outcome]));
  const warnings: string[] = [];
  const files: TestEvidence['files'] = [];
  let counts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  let trusted = 0;
  let hasFailures = false;
  let incompleteExecutedEvidence = false;
  const evidenceDirectory = join(runDirectory, 'evidence');
  for (const file of Object.values(after)) {
    const old = before[file.path];
    const fresh = !old || old.digest !== file.digest || old.size !== file.size || old.mtimeMs !== file.mtimeMs;
    if (!fresh) { files.push({ path: file.path, state: 'stale' }); continue; }
    const task = taskForEvidence(file.path);
    const outcome = outcomes.get(task);
    if (outcome !== 'EXECUTED' && outcome !== 'FAILED') {
      files.push({ path: file.path, state: 'untrusted' });
      warnings.push(`${file.path}: ${task}가 실제 실행되었다는 task 결과가 없어 집계하지 않았습니다.`);
      continue;
    }
    const sourcePath = join(canonicalRoot, ...file.path.split('/'));
    const sourceStat = fs.lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      files.push({ path: file.path, state: 'untrusted' });
      warnings.push(`${file.path}: 증거 파일이 일반 파일에서 링크 또는 다른 형식으로 바뀌어 집계하지 않았습니다.`);
      incompleteExecutedEvidence = true;
      continue;
    }
    const sourceContent = fs.readFileSync(sourcePath);
    if (sourceContent.length !== file.size || createHash('sha256').update(sourceContent).digest('hex') !== file.digest) {
      files.push({ path: file.path, state: 'untrusted' });
      warnings.push(`${file.path}: 증거 수집 중 파일이 바뀌어 집계하지 않았습니다.`);
      incompleteExecutedEvidence = true;
      continue;
    }
    let parsed: ReturnType<typeof parseCounts> = null;
    try { parsed = parseCounts(new TextDecoder('utf-8', { fatal: true }).decode(sourceContent)); }
    catch { /* Invalid encoding is untrusted evidence, never repaired into passing test counts. */ }
    if (!parsed) {
      files.push({ path: file.path, state: 'untrusted' });
      warnings.push(`${file.path}: 지원하는 Gradle JUnit XML 형식이 아니어서 집계하지 않았습니다.`);
      incompleteExecutedEvidence = true;
      continue;
    }
    fs.mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
    const copiedPath = join(evidenceDirectory, `${createHash('sha256').update(file.path).digest('hex').slice(0, 16)}-${basename(file.path)}`);
    fs.copyFileSync(sourcePath, copiedPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(copiedPath, 0o600);
    const copiedContent = fs.readFileSync(copiedPath);
    if (copiedContent.length !== file.size || createHash('sha256').update(copiedContent).digest('hex') !== file.digest) {
      fs.unlinkSync(copiedPath);
      files.push({ path: file.path, state: 'untrusted' });
      warnings.push(`${file.path}: 증거 복사 중 파일이 바뀌어 집계하지 않았습니다.`);
      incompleteExecutedEvidence = true;
      continue;
    }
    files.push({ path: file.path, state: 'fresh', copiedPath: portable(relative(runDirectory, copiedPath)) });
    hasFailures ||= parsed.failures + parsed.errors > 0;
    counts = { tests: counts.tests + parsed.tests, failures: counts.failures + parsed.failures, errors: counts.errors + parsed.errors, skipped: counts.skipped + parsed.skipped };
    if (Object.values(counts).some((value) => !Number.isSafeInteger(value))) {
      incompleteExecutedEvidence = true;
      warnings.push('테스트 XML 합계가 안전한 정수 범위를 넘어 집계하지 않았습니다.');
    }
    trusted += 1;
  }
  if (trusted === 0) {
    warnings.push('이번 실행에 연결된 새 테스트 XML 증거가 없어 테스트 수를 집계하지 않았습니다.');
    return { files, counts: null, hasFailures, warnings };
  }
  if (incompleteExecutedEvidence) {
    warnings.push('이번 실행의 새 XML 일부를 신뢰할 수 없어 부분 합계를 전체 결과로 표시하지 않습니다.');
    return { files, counts: null, hasFailures, warnings };
  }
  return { files, counts, hasFailures, warnings };
}
