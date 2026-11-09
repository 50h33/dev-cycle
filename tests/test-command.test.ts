import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, test } from 'node:test';
import { checkTestRunFreshness, readTestRun, runTest } from '../src/test.js';
import type { TestResult } from '../src/test.js';

const temporary: string[] = [];
after(() => {
  for (const path of temporary) fs.rmSync(path, { recursive: true, force: true });
});

function git(root: string, args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(path: string, content: string): void {
  fs.mkdirSync(join(path, '..'), { recursive: true });
  fs.writeFileSync(path, content);
}

function config(baseRef = 'HEAD'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    repository: 'example/test-project',
    defaultBranch: 'main',
    baseRef,
    paths: {
      conventions: 'AGENTS.md',
      issueTemplates: '.github/ISSUE_TEMPLATE',
      prTemplate: '.github/pull_request_template.md',
    },
    commands: {
      test: {
        executable: './gradlew', args: ['test', '--console=plain'],
        windows: { executable: './gradlew.bat', args: ['test', '--console=plain'] },
      },
    },
    test: {
      commonModules: ['common'],
      fullTestPaths: ['settings.gradle', 'build.gradle', 'gradle.properties', 'gradlew', 'gradlew.bat', 'gradle/', 'buildSrc/'],
      documentationPaths: ['docs/', 'README.md'],
    },
    artifactsDir: '.dev-cycle',
  };
}

const runner = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const mode = fs.readFileSync('.stub-mode', 'utf8').trim();
const task = process.argv.slice(2).find((arg) => arg === 'test' || /^:[A-Za-z0-9_.-]+:test$/.test(arg)) ?? 'test';
const match = /^:([^:]+):test$/.exec(task);
const module = match?.[1] ?? '';
if (mode === 'change-during') fs.appendFileSync('api/src/Main.java', '\\n// runner changed code');
if (mode !== 'fail') {
  const directory = path.join(module, 'build', 'test-results', 'test');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'TEST-stub.xml'), '<testsuite tests="2" failures="0" errors="0" skipped="1"></testsuite>');
}
if (mode === 'task-limit') {
  for (let index = 0; index <= 1000; index += 1) console.log('> Task :generated' + index + ':test');
} else {
  console.log('> Task ' + (task === 'test' ? ':test' : task) + (mode === 'fail' ? ' FAILED' : ''));
}
if (mode === 'fail') process.exitCode = 7;
`;

function repository(options: { mode?: string; baseRef?: string } = {}): string {
  const root = fs.mkdtempSync(join(tmpdir(), 'dev-cycle test 한글 '));
  temporary.push(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Dev Cycle Test']);
  git(root, ['config', 'user.email', 'dev-cycle@example.test']);
  write(join(root, 'settings.gradle'), "rootProject.name = 'sample'\ninclude 'api', 'common', 'worker'\n");
  write(join(root, 'dev-cycle.config.json'), `${JSON.stringify(config(options.baseRef), null, 2)}\n`);
  write(join(root, '.gitignore'), '.dev-cycle/\n.gradle/\nbuild/\n**/build/\n');
  write(join(root, '.stub-mode'), `${options.mode ?? 'success'}\n`);
  write(join(root, 'README.md'), '# sample\n');
  write(join(root, 'api/src/Main.java'), 'class Main {}\n');
  write(join(root, 'common/src/Common.java'), 'class Common {}\n');
  write(join(root, 'worker/src/Worker.java'), 'class Worker {}\n');
  write(join(root, 'gradlew'), runner);
  fs.chmodSync(join(root, 'gradlew'), 0o755);
  write(join(root, 'gradlew.bat'), '@echo off\nnode "%~dp0gradlew" %*\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'initial']);
  return root;
}

function treeDigest(root: string): string {
  const hash = createHash('sha256');
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      const name = relative(root, path).replaceAll('\\', '/');
      hash.update(name).update('\0');
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) hash.update(fs.readFileSync(path));
    }
  };
  walk(root);
  return hash.digest('hex');
}

async function successfulRun(options: { mode?: string; baseRef?: string } = {}): Promise<{ root: string; result: TestResult }> {
  const root = repository(options);
  fs.appendFileSync(join(root, 'api/src/Main.java'), '// changed\n');
  const result = await runTest({ target: root });
  return { root, result };
}

test('dry-run은 Git 내부를 포함한 대상 파일을 바꾸지 않고 선택과 명령만 반환한다', async () => {
  const root = repository();
  fs.appendFileSync(join(root, 'api/src/Main.java'), '// changed\n');
  const before = treeDigest(root);
  const result = await runTest({ target: join(root, 'api'), dryRun: true });
  assert.equal(result.status, 'not-run');
  assert.equal(result.analysis, 'complete');
  assert.equal(result.selection?.mode, 'modules');
  assert.deepEqual(result.selection?.tasks, [':api:test']);
  assert.equal(result.runId, null);
  assert.equal(result.recordPath, null);
  assert.equal(treeDigest(root), before);
});

test('성공 프로세스의 종료 상태, task 출력과 이번 실행의 새 XML을 기록한다', async () => {
  const { result } = await successfulRun();
  assert.equal(result.status, 'succeeded');
  assert.equal(result.exitCode, 0);
  assert.equal(result.execution?.started, true);
  assert.equal(result.execution?.exitCode, 0);
  assert.deepEqual(result.execution?.tasks, [{ task: ':api:test', outcome: 'EXECUTED' }]);
  assert.deepEqual(result.evidence?.counts, { tests: 2, failures: 0, errors: 0, skipped: 1 });
  assert.equal(result.evidence?.files[0]?.state, 'fresh');
  assert.ok(result.recordPath && fs.existsSync(result.recordPath));
  assert.equal(readTestRun(result.recordPath!).status, 'succeeded');
  assert.equal(checkTestRunFreshness(result).status, 'current');
});

test('실제 비정상 종료를 실패로 보존하고 과거 XML을 성공 증거로 사용하지 않는다', async () => {
  const root = repository({ mode: 'fail' });
  fs.mkdirSync(join(root, 'api/build/test-results/test'), { recursive: true });
  write(join(root, 'api/build/test-results/test/TEST-old.xml'), '<testsuite tests="9" failures="0" errors="0" skipped="0"></testsuite>');
  fs.appendFileSync(join(root, 'api/src/Main.java'), '// changed\n');
  const result = await runTest({ target: root });
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 1);
  assert.equal(result.execution?.exitCode, 7);
  assert.equal(result.evidence?.counts, null);
  assert.deepEqual(result.evidence?.files.map((file) => file.state), ['stale']);
});

test('문서만 변경, 변경 없음과 생성된 결과 파일만 있는 경우를 실행 없이 생략한다', async () => {
  const clean = repository();
  assert.equal(git(clean, ['status', '--porcelain=v1', '--untracked-files=all']), '');
  const noChanges = await runTest({ target: clean });
  assert.equal(noChanges.status, 'skipped', JSON.stringify({ selection: noChanges.selection, errors: noChanges.errors }));
  assert.match(noChanges.selection?.reasons[0] ?? '', /변경된 경로가 없어/);
  assert.equal(noChanges.execution, null);

  const docs = repository();
  fs.appendFileSync(join(docs, 'README.md'), 'docs\n');
  assert.equal(git(docs, ['status', '--porcelain=v1', '--untracked-files=all']), 'M README.md');
  const docsResult = await runTest({ target: docs });
  assert.equal(docsResult.status, 'skipped', JSON.stringify(docsResult.selection));
  assert.match(docsResult.selection?.reasons[0] ?? '', /문서/);

  const outputs = repository();
  write(join(outputs, '.dev-cycle/runs/old/record.json'), '{}\n');
  write(join(outputs, 'api/build/test-results/test/TEST-old.xml'), '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>');
  const outputResult = await runTest({ target: outputs, dryRun: true });
  assert.equal(outputResult.selection?.mode, 'skip', JSON.stringify(outputResult.selection));
  assert.match(outputResult.selection?.reasons[0] ?? '', /변경된 경로가 없어/);
});

test('staged와 untracked 변경을 함께 분석하고 명시한 baseRef가 설정값을 대체한다', async () => {
  const root = repository({ baseRef: 'missing-ref' });
  fs.appendFileSync(join(root, 'api/src/Main.java'), '// staged\n');
  git(root, ['add', 'api/src/Main.java']);
  write(join(root, 'worker/src/New.java'), 'class New {}\n');
  const result = await runTest({ target: root, baseRef: 'HEAD', dryRun: true });
  assert.equal(result.analysis, 'complete');
  assert.equal(result.comparison?.baseRef, 'HEAD');
  assert.deepEqual(result.selection?.modules, ['api', 'worker']);
});

test('모듈 삭제와 디렉터리 rename은 현재 settings 기준 전체 태스크만 선택한다', async () => {
  for (const scenario of ['delete', 'rename'] as const) {
    const root = repository();
    const current = scenario === 'delete' ? ['api', 'common'] : ['api', 'common', 'jobs'];
    if (scenario === 'delete') {
      fs.rmSync(join(root, 'worker/src/Worker.java'));
      fs.rmdirSync(join(root, 'worker/src'));
      fs.rmdirSync(join(root, 'worker'));
    } else {
      fs.renameSync(join(root, 'worker'), join(root, 'jobs'));
    }
    write(join(root, 'settings.gradle'), `rootProject.name = 'sample'\ninclude ${current.map((module) => `'${module}'`).join(', ')}\n`);
    const result = await runTest({ target: root, dryRun: true });
    assert.equal(result.analysis, 'complete');
    assert.equal(result.selection?.mode, 'all');
    assert.deepEqual(result.selection?.modules, current);
    assert.deepEqual(result.selection?.tasks, ['test']);
    assert.ok(!result.invocation?.args.includes(':worker:test'));
    assert.ok(!result.invocation?.args.includes(':jobs:test'));
  }
});

test('잘못된 비교 ref와 지원하지 않는 settings 문법을 분석 성공으로 표시하지 않는다', async () => {
  const invalidRef = repository({ baseRef: 'missing-ref' });
  const refResult = await runTest({ target: invalidRef, dryRun: true });
  assert.equal(refResult.analysis, 'error');
  assert.equal(refResult.exitCode, 2);
  assert.match(refResult.errors[0] ?? '', /Git 조회 실패/);

  const invalidSettings = repository();
  write(join(invalidSettings, 'settings.gradle'), "def modules = ['api']\ninclude modules\n");
  const settingsResult = await runTest({ target: invalidSettings, dryRun: true });
  assert.equal(settingsResult.analysis, 'error');
  assert.equal(settingsResult.exitCode, 2);
  assert.match(settingsResult.errors[0] ?? '', /settings.gradle/);

  const missingModule = repository();
  fs.rmSync(join(missingModule, 'worker/src/Worker.java'));
  fs.rmdirSync(join(missingModule, 'worker/src'));
  fs.rmdirSync(join(missingModule, 'worker'));
  const missingModuleResult = await runTest({ target: missingModule, dryRun: true });
  assert.equal(missingModuleResult.analysis, 'error');
  assert.equal(missingModuleResult.exitCode, 2);
  assert.match(missingModuleResult.errors[0] ?? '', /worker/);
});

test('변경 분석 중 코드가 바뀌면 실행과 기록 전에 명시적으로 중단한다', async (context) => {
  const root = repository();
  const settingsPath = join(fs.realpathSync.native(root), 'settings.gradle');
  fs.appendFileSync(join(root, 'api/src/Main.java'), '// initial change\n');
  const originalRead = fsDefault.readFileSync.bind(fsDefault) as typeof fsDefault.readFileSync;
  let settingsReads = 0;
  let changed = false;
  context.mock.method(fsDefault, 'readFileSync', ((path: fs.PathOrFileDescriptor, options?: unknown) => {
    if (typeof path === 'string' && path === settingsPath && options === 'utf8') {
      settingsReads += 1;
      if (settingsReads === 2) {
        fs.appendFileSync(join(root, 'api/src/Main.java'), '// changed during analysis\n');
        changed = true;
      }
    }
    return originalRead(path, options as never);
  }) as typeof fsDefault.readFileSync);
  syncBuiltinESMExports();
  let result: TestResult;
  try {
    result = await runTest({ target: root });
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(changed, true);
  assert.equal(settingsReads, 2);
  assert.equal(result.status, 'not-run');
  assert.equal(result.analysis, 'error');
  assert.equal(result.exitCode, 2);
  assert.match(result.errors[0] ?? '', /변경 분석 중 코드 또는 설정이 바뀌었습니다/);
  assert.equal(result.runId, null);
  assert.equal(result.recordPath, null);
  assert.equal(fs.existsSync(join(root, '.dev-cycle')), false);
});

test('변경 분석 중 비교 ref가 다른 기존 commit으로 이동하면 실행 전에 중단한다', async (context) => {
  const root = repository({ baseRef: 'base' });
  const settingsPath = join(fs.realpathSync.native(root), 'settings.gradle');
  git(root, ['branch', 'base']);
  fs.appendFileSync(join(root, 'README.md'), 'base candidate\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'base candidate']);
  const movedBase = git(root, ['rev-parse', 'HEAD']);
  fs.appendFileSync(join(root, 'api/src/Main.java'), '// head commit\n');
  git(root, ['add', 'api/src/Main.java']);
  git(root, ['commit', '-m', 'head commit']);
  assert.notEqual(movedBase, git(root, ['rev-parse', 'HEAD']));

  const originalRead = fsDefault.readFileSync.bind(fsDefault) as typeof fsDefault.readFileSync;
  let settingsReads = 0;
  context.mock.method(fsDefault, 'readFileSync', ((path: fs.PathOrFileDescriptor, options?: unknown) => {
    if (typeof path === 'string' && path === settingsPath && options === 'utf8') {
      settingsReads += 1;
      if (settingsReads === 2) git(root, ['update-ref', 'refs/heads/base', movedBase]);
    }
    return originalRead(path, options as never);
  }) as typeof fsDefault.readFileSync);
  syncBuiltinESMExports();
  let result: TestResult;
  try {
    result = await runTest({ target: root });
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(settingsReads, 2);
  assert.equal(result.status, 'not-run');
  assert.equal(result.analysis, 'error');
  assert.equal(result.exitCode, 2);
  assert.match(result.errors[0] ?? '', /변경 분석 중 코드 또는 설정이 바뀌었습니다/);
  assert.equal(result.runId, null);
  assert.equal(result.recordPath, null);
  assert.equal(fs.existsSync(join(root, '.dev-cycle')), false);
});

test('생략 실행의 최종 기록 저장이 실패하면 skipped가 아닌 failed로 남긴다', async (context) => {
  const root = repository();
  const originalWrite = fsDefault.writeFileSync.bind(fsDefault) as typeof fsDefault.writeFileSync;
  let recordWrites = 0;
  context.mock.method(fsDefault, 'writeFileSync', ((path: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: unknown) => {
    if (typeof path === 'string' && path.endsWith('record.json.tmp')) {
      recordWrites += 1;
      if (recordWrites === 2) throw Object.assign(new Error('injected final save failure'), { code: 'EIO' });
    }
    return originalWrite(path, data, options as never);
  }) as typeof fsDefault.writeFileSync);
  syncBuiltinESMExports();
  let result: TestResult;
  try {
    result = await runTest({ target: root });
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(recordWrites, 3);
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 2);
  assert.match(result.errors.join('\n'), /injected final save failure/);
  assert.ok(result.recordPath && fs.existsSync(result.recordPath));
  assert.equal(readTestRun(result.recordPath!).status, 'failed');
});

test('실행된 프로세스의 task 출력 한도 오류는 중단이 아닌 실패 상태로 기록한다', async () => {
  const root = repository({ mode: 'task-limit' });
  fs.appendFileSync(join(root, 'api/src/Main.java'), '// changed\n');
  const result = await runTest({ target: root });
  assert.equal(result.execution?.started, true);
  assert.match(result.execution?.error ?? '', /1000개/);
  assert.equal(result.execution?.interrupted, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 2);
});

test('실행 뒤 코드나 설정이 바뀌면 stale이고 필수 파일이 사라지면 freshness를 알 수 없다', async () => {
  const code = await successfulRun();
  fs.appendFileSync(join(code.root, 'api/src/Main.java'), '// later\n');
  assert.equal(checkTestRunFreshness(code.result).status, 'changed');

  const configuredRoot = repository({ baseRef: 'missing-ref' });
  fs.appendFileSync(join(configuredRoot, 'api/src/Main.java'), '// changed\n');
  const configuredResult = await runTest({ target: configuredRoot, baseRef: 'HEAD' });
  assert.equal(configuredResult.status, 'succeeded');
  assert.equal(configuredResult.comparison?.baseRef, 'HEAD');
  const changedConfig = config('other-ref');
  write(join(configuredRoot, 'dev-cycle.config.json'), `${JSON.stringify(changedConfig, null, 2)}\n`);
  assert.equal(checkTestRunFreshness(configuredResult).status, 'changed');

  const missing = await successfulRun();
  fs.rmSync(join(missing.root, 'settings.gradle'));
  assert.equal(checkTestRunFreshness(missing.result).status, 'unknown');
});

test('실행 중 코드가 바뀌면 성공 종료와 별개로 변경된 코드 상태를 기록한다', async () => {
  const { result } = await successfulRun({ mode: 'change-during' });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.codeState, 'changed');
  assert.match(result.warnings.join('\n'), /실행 전후 코드/);
  assert.equal(checkTestRunFreshness(result).status, 'changed');
});

test('미완료 기록을 성공으로 복구하지 않고 incomplete와 interrupted로 정규화한다', async () => {
  const { result } = await successfulRun();
  const path = result.recordPath!;
  for (const status of ['running', 'skipped'] as const) {
    const journal: TestResult = { ...result, status, endedAt: null, after: null, execution: null, evidence: null, codeState: 'unknown', warnings: [],
      ...(status === 'skipped' ? { invocation: null, selection: { ...result.selection!, mode: 'skip', modules: [], tasks: [] } } : {}) };
    write(path, `${JSON.stringify(journal)}\n`);
    const recovered = readTestRun(path);
    assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.exitCode, 130);
    assert.equal(recovered.codeState, 'unknown');
    assert.match(recovered.warnings[0] ?? '', /미완료/);
    assert.equal(checkTestRunFreshness(recovered).status, 'incomplete');
  }
  write(path, JSON.stringify({ schemaVersion: 1, command: 'test', status: 'succeeded', errors: [], warnings: [] }));
  assert.throws(() => readTestRun(path), /잘못/u);
});

test('완료 기록의 상태와 실행 결과 또는 증거 경로가 모순되면 읽기를 거부한다', async () => {
  const { result } = await successfulRun();
  assert.ok(result.execution && result.evidence);
  assert.equal(readTestRun(result.recordPath!).status, 'succeeded');
  const skipped: TestResult = { ...result, status: 'skipped', execution: null, invocation: null, evidence: null,
    selection: { ...result.selection!, mode: 'skip', modules: [], tasks: [] } };
  const cases: TestResult[] = [
    { ...structuredClone(result), exitCode: 1 },
    { ...structuredClone(result), endedAt: null },
    { ...structuredClone(result), artifactsDir: '../outside' },
    { ...structuredClone(result), runId: '00000000-0000-0000-0000-000000000000' },
    { ...structuredClone(result), execution: { ...result.execution!, exitCode: 7 } },
    ...(['analysis', 'comparison', 'selection', 'invocation', 'evidence', 'before', 'after'] as const)
      .map((key) => ({ ...structuredClone(result), [key]: key === 'analysis' ? 'error' : null } as TestResult)),
    ...(['analysis', 'comparison', 'before', 'after'] as const)
      .map((key) => ({ ...structuredClone(skipped), [key]: key === 'analysis' ? 'error' : null } as TestResult)),
    {
      ...structuredClone(result),
      evidence: {
        ...result.evidence!,
        files: [{ path: 'api/build/test-results/test/TEST-stub.xml', state: 'fresh', copiedPath: '../escape' }],
      },
    },
  ];
  for (const [index, value] of cases.entries()) {
    const path = result.recordPath!;
    write(path, `${JSON.stringify(value)}\n`);
    assert.throws(() => readTestRun(path), /테스트 실행 기록.*잘못/, `tampered terminal record case ${index}`);
  }
  const relocated = join(result.root!, 'relocated.json');
  write(relocated, JSON.stringify({ ...result, recordPath: relocated }));
  assert.throws(() => readTestRun(relocated), /잘못/u);
});
