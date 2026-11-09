#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInit } from './init.js';
import type { InitResult } from './init.js';
import { runTest } from './test.js';
import type { TestResult } from './test.js';
import { runReport } from './report.js';

const usage = `사용법:
  dev-cycle init [대상 경로] [--config <파일>] [--dry-run] [--json]
  dev-cycle test [대상 경로] [--config <파일>] [--base-ref <ref>] [--dry-run] [--json]
  dev-cycle report [대상 경로] [--config <파일>] [--run-id <UUID>] [--output <파일>] [--dry-run] [--json]
  dev-cycle --help
  dev-cycle --version

옵션:
  --config <파일>  실행한 디렉터리 기준 프로젝트 설정 파일
  --base-ref <ref> test의 명시적인 Git 비교 기준
  --run-id <UUID>  report에서 읽을 실행 기록 (기본: 최신 시작 시각)
  --output <파일>  report Markdown을 artifactsDir/reports 아래에 새로 저장
  --dry-run        파일을 쓰거나 테스트를 실행하지 않고 계획만 확인
  --json           기계가 읽을 수 있는 단일 JSON 객체 출력
  -h, --help       도움말 출력
  --version        패키지 버전 출력`;

interface CliFailure {
  schemaVersion: 1;
  command: 'init' | 'test' | 'report' | null;
  status: 'failed';
  errors: string[];
  exitCode: 2;
}

class UsageError extends Error {}

function failure(command: CliFailure['command'], message: string): CliFailure {
  return { schemaVersion: 1, command, status: 'failed', errors: [message], exitCode: 2 };
}

function packageVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    try {
      const value = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { version?: unknown };
      if (typeof value.version === 'string') return value.version;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('package.json에서 버전을 찾을 수 없습니다.');
}

function humanResult(result: InitResult): string {
  const lines = [
    `dev-cycle init: ${result.status}`,
    `대상 Git 루트: ${result.root ?? '확인하지 못함'}`,
    `템플릿 버전: ${result.templateVersion ?? '확인하지 못함'}`,
  ];
  if (result.config) {
    lines.push(`저장소 설정: ${result.config.repository}`);
    lines.push(`기본 브랜치: ${result.config.defaultBranch}`);
    lines.push(`결과 디렉터리: ${result.config.artifactsDir}`);
  }
  if (result.dryRun) lines.push('dry-run: 대상 저장소를 변경하지 않았습니다.');
  if (result.files.length > 0) {
    lines.push('', '파일:');
    for (const file of result.files) {
      lines.push(`  [${file.status}] ${file.path} - ${file.message}${file.partial ? ' (부분 파일 가능)' : ''}`);
    }
  }
  if (result.createdDirectories.length > 0) {
    lines.push('', '생성한 디렉터리:');
    lines.push(...result.createdDirectories.map((path) => `  ${path}`));
  }
  if (result.warnings.length > 0) {
    lines.push('', '경고:');
    lines.push(...result.warnings.map((message) => `  ${message}`));
  }
  if (result.errors.length > 0) {
    lines.push('', '오류와 사용자 조치:');
    lines.push(...result.errors.map((message) => `  ${message}`));
  }
  return `${lines.join('\n')}\n`;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function humanTestResult(result: TestResult): string {
  const lines = [`dev-cycle test: ${result.status}`, `분석: ${result.analysis}`, `대상 Git 루트: ${result.root ?? '확인하지 못함'}`];
  if (result.selection) {
    lines.push(`선택: ${result.selection.mode} (${result.selection.modules.join(', ') || '없음'})`);
    lines.push(...result.selection.reasons.map((reason) => `  ${reason}`));
    for (const change of result.selection.paths) lines.push(`  [${change.status}] ${change.previousPath ? `${change.previousPath} -> ` : ''}${change.path}`);
  }
  if (result.invocation) lines.push(`실행 파일: ${result.invocation.executable}`, `인자(JSON): ${JSON.stringify(result.invocation.args)}`);
  if (result.dryRun) lines.push('dry-run: 테스트와 기록 생성을 수행하지 않았습니다.');
  if (result.execution) {
    lines.push(`프로세스 종료 코드: ${result.execution.exitCode ?? '없음'}, signal: ${result.execution.signal ?? '없음'}`);
    for (const task of result.execution.tasks) lines.push(`  ${task.task}: ${task.outcome}`);
    lines.push('프로세스 성공과 새 테스트 실행 여부는 별도입니다.');
  }
  if (result.evidence?.counts) {
    const count = result.evidence.counts;
    lines.push(`이번 실행 XML: tests=${count.tests}, failures=${count.failures}, errors=${count.errors}, skipped=${count.skipped}`);
  } else if (result.execution) lines.push('이번 실행에 연결된 새 테스트 수: 확인되지 않음');
  if (result.recordPath) lines.push(`기록: ${result.recordPath}`, `실행 전후 코드: ${result.codeState}`);
  lines.push(...result.warnings.map((warning) => `경고: ${warning}`), ...result.errors.map((error) => `오류: ${error}`));
  return `${lines.join('\n')}\n`;
}

function writeFailure(value: CliFailure, json: boolean): void {
  if (json) {
    writeJson(value);
    return;
  }
  process.stderr.write(`오류: ${value.errors.join('\n')}\n\n${usage}\n`);
}

function takeSingleFlag(args: string[], flag: string): boolean {
  const count = args.filter((arg) => arg === flag).length;
  if (count > 1) throw new UsageError(`${flag} 옵션은 한 번만 지정할 수 있습니다.`);
  if (count === 1) args.splice(args.indexOf(flag), 1);
  return count === 1;
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const args = [...argv];
  const jsonRequested = args.includes('--json');
  let command: CliFailure['command'] = null;
  try {
    const json = takeSingleFlag(args, '--json');
    const helpCount = args.filter((arg) => arg === '--help' || arg === '-h').length;
    if (helpCount > 1) throw new UsageError('도움말 옵션은 한 번만 지정할 수 있습니다.');
    if (helpCount === 1) {
      if (args.length > 2 || (args.length === 2 && !['init', 'test', 'report'].includes(args[0]!))) {
        throw new UsageError('도움말에는 명령 외의 인자를 함께 지정할 수 없습니다.');
      }
      if (json) writeJson({ schemaVersion: 1, command: ['init', 'test', 'report'].find((name) => args.includes(name)) ?? null, status: 'help', usage, exitCode: 0 });
      else process.stdout.write(`${usage}\n`);
      return 0;
    }
    if (args.length === 0) {
      if (json) writeJson({ schemaVersion: 1, command: null, status: 'help', usage, exitCode: 0 });
      else process.stdout.write(`${usage}\n`);
      return 0;
    }
    if (args.includes('--version')) {
      if (args.length !== 1) throw new UsageError('--version은 다른 명령이나 인자와 함께 사용할 수 없습니다.');
      const version = packageVersion();
      if (json) writeJson({ schemaVersion: 1, command: null, status: 'version', version, exitCode: 0 });
      else process.stdout.write(`${version}\n`);
      return 0;
    }

    const name = args.shift();
    if (name !== 'init' && name !== 'test' && name !== 'report') throw new UsageError(`지원하지 않는 명령입니다: ${name ?? ''}`);
    command = name;
    let target: string | undefined;
    let configPath: string | undefined;
    let baseRef: string | undefined;
    let runId: string | undefined;
    let outputPath: string | undefined;
    let dryRun = false;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === '--dry-run') {
        if (dryRun) throw new UsageError('--dry-run 옵션은 한 번만 지정할 수 있습니다.');
        dryRun = true;
      } else if (argument === '--config') {
        if (configPath !== undefined) throw new UsageError('--config 옵션은 한 번만 지정할 수 있습니다.');
        const value = args[index + 1];
        if (!value || value.startsWith('-')) throw new UsageError('--config 다음에 설정 파일 경로를 지정하세요.');
        configPath = value;
        index += 1;
      } else if (argument.startsWith('--config=')) {
        if (configPath !== undefined) throw new UsageError('--config 옵션은 한 번만 지정할 수 있습니다.');
        configPath = argument.slice('--config='.length);
        if (!configPath) throw new UsageError('--config= 다음에 설정 파일 경로를 지정하세요.');
      } else if (command === 'test' && (argument === '--base-ref' || argument.startsWith('--base-ref='))) {
        if (baseRef !== undefined) throw new UsageError('--base-ref 옵션은 한 번만 지정할 수 있습니다.');
        baseRef = argument === '--base-ref' ? args[++index] : argument.slice('--base-ref='.length);
        if (!baseRef || baseRef.startsWith('-')) throw new UsageError('--base-ref 다음에 비교 ref를 지정하세요.');
      } else if (command === 'report' && (argument === '--run-id' || argument.startsWith('--run-id='))) {
        if (runId !== undefined) throw new UsageError('--run-id 옵션은 한 번만 지정할 수 있습니다.');
        runId = argument === '--run-id' ? args[++index] : argument.slice('--run-id='.length);
        if (!runId || runId.startsWith('-')) throw new UsageError('--run-id 다음에 실행 UUID를 지정하세요.');
      } else if (command === 'report' && (argument === '--output' || argument.startsWith('--output='))) {
        if (outputPath !== undefined) throw new UsageError('--output 옵션은 한 번만 지정할 수 있습니다.');
        outputPath = argument === '--output' ? args[++index] : argument.slice('--output='.length);
        if (!outputPath || outputPath.startsWith('-')) throw new UsageError('--output 다음에 출력 파일 경로를 지정하세요.');
      } else if (argument.startsWith('-')) {
        throw new UsageError(`지원하지 않는 옵션입니다: ${argument}`);
      } else if (target === undefined) {
        if (!argument) throw new UsageError('빈 대상 경로 대신 실제 경로를 지정하거나 대상 인자를 생략하세요.');
        target = argument;
      } else {
        throw new UsageError(`대상 경로는 하나만 지정할 수 있습니다: ${argument}`);
      }
    }

    const options = {
      cwd: process.cwd(),
      ...(target === undefined ? {} : { target }),
      ...(configPath === undefined ? {} : { configPath }),
      dryRun,
    };
    if (command === 'init') {
      const result = runInit(options);
      if (json) writeJson(result);
      else process.stdout.write(humanResult(result));
      return result.exitCode;
    }
    if (command === 'report') {
      const result = runReport({ ...options, ...(runId === undefined ? {} : { runId }), ...(outputPath === undefined ? {} : { outputPath }) });
      if (json) writeJson(result);
      else process.stdout.write(result.markdown);
      return result.exitCode;
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    try {
      const result = await runTest({ ...options, ...(baseRef === undefined ? {} : { baseRef }), signal: controller.signal });
      if (json) writeJson(result);
      else process.stdout.write(humanTestResult(result));
      return result.exitCode;
    } finally {
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = failure(command, message);
    writeFailure(result, jsonRequested);
    return result.exitCode;
  }
}

function sameFile(left: string, right: string): boolean {
  try {
    const actualLeft = realpathSync.native(left);
    const actualRight = realpathSync.native(right);
    return process.platform === 'win32'
      ? actualLeft.toLowerCase() === actualRight.toLowerCase()
      : actualLeft === actualRight;
  } catch {
    return false;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && sameFile(invokedPath, fileURLToPath(import.meta.url))) {
  process.exitCode = await runCli();
}
