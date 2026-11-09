import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectTestEvidence, executeTestCommand, prepareTestCommand, snapshotTestEvidence } from '../src/test-process.js';
import type { WorkflowConfig } from '../src/workflow.js';

function config(): WorkflowConfig {
  return {
    schemaVersion: 1, repository: 'owner/repo', defaultBranch: 'main', baseRef: 'main',
    paths: { conventions: 'AGENTS.md', issueTemplates: '.github/ISSUE_TEMPLATE', prTemplate: '.github/pull_request_template.md' },
    commands: { test: { executable: './gradlew', args: ['test'], windows: { executable: './gradlew.bat', args: ['test'] } } },
    test: { commonModules: [], fullTestPaths: [], documentationPaths: [] }, artifactsDir: '.dev-cycle',
  };
}

function workspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `dev-cycle process ${name} 한글 `));
}

test('Gradle Wrapper와 제한된 옵션만 사용하고 선택 태스크를 교체한다', () => {
  const root = workspace('prepare');
  try {
    const command = prepareTestCommand(root, config(), [':app:test'], 'linux');
    assert.equal(command.executable, join(root, 'gradlew'));
    assert.deepEqual(command.args, [':app:test', '--console=plain', '--no-daemon']);
    assert.deepEqual(prepareTestCommand(root, config(), [':한글-모듈:test'], 'linux').args, [':한글-모듈:test', '--console=plain', '--no-daemon']);
    const windows = prepareTestCommand(root, config(), ['test'], 'win32');
    assert.match(windows.executable, /cmd\.exe$/iu);
    assert.deepEqual(windows.args.slice(0, 4), ['/d', '/s', '/v:off', '/c']);

    const invalid = config();
    invalid.commands.test!.args = ['test', '--tests', '*Example'];
    assert.throws(() => prepareTestCommand(root, invalid, ['test'], 'linux'), /지원하지 않는/u);
    invalid.commands.test!.args = ['test'];
    invalid.commands.test!.windows!.args = ['test', 'x&whoami'];
    assert.throws(() => prepareTestCommand(root, invalid, ['test'], 'win32'), /지원하지 않는|특수문자/u);

    const fallback = config();
    fallback.commands.test = { executable: './gradlew.bat', args: ['test'] };
    assert.match(prepareTestCommand(root, fallback, ['test'], 'win32').executable, /cmd\.exe$/iu);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('실제 종료 코드, task outcome과 크기 제한 로그를 기록한다', async () => {
  const root = workspace('execute');
  const run = join(root, 'run');
  try {
    const script = `process.stdout.write('> Task :app:test\\n'); process.stdout.write('x'.repeat(1100000)); process.stderr.write('failure'); process.exitCode=7`;
    const result = await executeTestCommand({ executable: process.execPath, args: ['-e', script], cwd: root }, run);
    assert.equal(result.started, true);
    assert.equal(result.exitCode, 7);
    assert.deepEqual(result.tasks, [{ task: ':app:test', outcome: 'EXECUTED' }]);
    assert.equal(result.stdout.truncated, true);
    assert.equal(readFileSync(result.stdout.path).length, 1024 * 1024);
    assert.equal(readFileSync(result.stderr.path, 'utf8'), 'failure');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('분할된 UTF-8 task 이름도 손상 없이 수집한다', async () => {
  const root = workspace('utf8 split');
  try {
    const script = `const value=Buffer.from('> Task :한글-모듈:test\\n'); const split=value.indexOf(0xed)+1; process.stdout.write(value.subarray(0,split)); setTimeout(()=>process.stdout.write(value.subarray(split)),100);`;
    const result = await executeTestCommand({ executable: process.execPath, args: ['-e', script], cwd: root }, join(root, 'run'));
    assert.equal(result.exitCode, 0, result.error ?? 'process failed');
    assert.deepEqual(result.tasks, [{ task: ':한글-모듈:test', outcome: 'EXECUTED' }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Windows 배치 인터프리터는 상속된 ComSpec으로 바뀌지 않는다', () => {
  const root = workspace('interpreter');
  const previous = process.env.ComSpec;
  try {
    process.env.ComSpec = join(root, 'unrelated-shim.exe');
    const command = prepareTestCommand(root, config(), [':app:test'], 'win32');
    assert.equal(command.executable, join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'));
  } finally {
    if (previous === undefined) delete process.env.ComSpec;
    else process.env.ComSpec = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows 배치 Wrapper는 공백 경로에서도 cmd 경계를 통해 인자를 그대로 받는다', { skip: process.platform !== 'win32' }, async () => {
  const root = workspace('batch wrapper');
  try {
    writeFileSync(join(root, 'capture.cjs'), "console.log(JSON.stringify(process.argv.slice(2))); console.log('> Task :app:test');\n");
    writeFileSync(join(root, 'gradlew.bat'), `@echo off\r\n"${process.execPath}" "%~dp0capture.cjs" %*\r\n`);
    const command = prepareTestCommand(root, config(), [':app:test'], 'win32');
    const result = await executeTestCommand(command, join(root, 'run'));
    assert.equal(result.exitCode, 0, result.error ?? readFileSync(result.stderr.path, 'utf8'));
    assert.match(readFileSync(result.stdout.path, 'utf8'), /\[":app:test","--console=plain","--no-daemon"\]/u);
    assert.deepEqual(result.tasks, [{ task: ':app:test', outcome: 'EXECUTED' }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('시작 실패는 미실행이고 중단은 별도 상태로 남는다', async () => {
  const root = workspace('failure');
  try {
    const missing = await executeTestCommand({ executable: join(root, 'missing-command'), args: [], cwd: root }, join(root, 'missing'));
    assert.equal(missing.started, false);
    assert.equal(missing.exitCode, null);
    assert.ok(missing.error);

    const prepared = prepareTestCommand(root, config(), ['test'], process.platform);
    const missingWrapper = await executeTestCommand(prepared, join(root, 'missing-wrapper'));
    assert.equal(missingWrapper.started, false);
    assert.match(missingWrapper.error ?? '', /Wrapper/u);
    assert.equal(existsSync(join(root, 'missing-wrapper')), false);

    const controller = new AbortController();
    const pending = executeTestCommand({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: root }, join(root, 'abort'), controller.signal);
    setTimeout(() => controller.abort(), 100);
    const interrupted = await pending;
    assert.equal(interrupted.started, true);
    assert.equal(interrupted.interrupted, true);
    assert.notEqual(interrupted.signal === null && interrupted.exitCode === 0, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('중단하면 하위 프로세스도 종료되어 지연된 파일을 만들지 않는다', async () => {
  const root = workspace('descendant abort');
  const pidFile = join(root, 'descendant.pid');
  const ready = join(root, 'descendant.ready');
  const marker = join(root, 'must-not-exist.txt');
  try {
    const descendant = `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(ready)},'ready'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},'alive'),1200);`;
    const parent = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); setInterval(()=>{},1000);`;
    const controller = new AbortController();
    const pending = executeTestCommand({ executable: process.execPath, args: ['-e', parent], cwd: root }, join(root, 'run'), controller.signal);
    for (let attempts = 0; attempts < 100 && !existsSync(ready); attempts += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(existsSync(ready), true, 'descendant did not schedule its marker');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    controller.abort();
    const result = await pending;
    assert.equal(result.interrupted, true);
    for (let attempts = 0; attempts < 50; attempts += 1) {
      try { process.kill(pid, 0); await new Promise((resolve) => setTimeout(resolve, 20)); }
      catch { break; }
    }
    assert.throws(() => process.kill(pid, 0));
    await new Promise((resolve) => setTimeout(resolve, 1300));
    assert.equal(existsSync(marker), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('POSIX에서 SIGTERM을 무시하는 하위 프로세스도 유예 후 강제 종료한다', { skip: process.platform === 'win32' }, async () => {
  const root = workspace('sigterm descendant');
  const pidFile = join(root, 'descendant.pid');
  const ready = join(root, 'descendant.ready');
  const marker = join(root, 'must-not-exist.txt');
  try {
    const descendant = `const fs=require('node:fs'); process.on('SIGTERM',()=>{}); fs.writeFileSync(${JSON.stringify(ready)},'ready'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},'alive'),3000); setInterval(()=>{},1000);`;
    const parent = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000);`;
    const controller = new AbortController();
    const pending = executeTestCommand({ executable: process.execPath, args: ['-e', parent], cwd: root }, join(root, 'run'), controller.signal);
    for (let attempts = 0; attempts < 100 && !existsSync(ready); attempts += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(existsSync(ready), true, 'descendant did not install its SIGTERM handler');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const abortedAt = Date.now();
    controller.abort();
    const result = await pending;
    assert.equal(result.interrupted, true);
    assert.ok(Date.now() - abortedAt >= 1300, 'cleanup grace period was not awaited');
    for (let attempts = 0; attempts < 100; attempts += 1) {
      try { process.kill(pid, 0); await new Promise((resolve) => setTimeout(resolve, 20)); }
      catch { break; }
    }
    assert.throws(() => process.kill(pid, 0));
    await new Promise((resolve) => setTimeout(resolve, 1700));
    assert.equal(existsSync(marker), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('task outcome 기록 한도 초과는 사용자 중단이 아닌 실행 오류로 남는다', async () => {
  const root = workspace('task limit');
  try {
    const script = `for(let i=0;i<1001;i++) process.stdout.write('> Task :module'+i+':test\\n'); setInterval(()=>{},1000);`;
    const result = await executeTestCommand({ executable: process.execPath, args: ['-e', script], cwd: root }, join(root, 'run'));
    assert.equal(result.started, true);
    assert.equal(result.interrupted, false);
    assert.match(result.error ?? '', /1000개/u);
    assert.equal(result.tasks.length, 1000);
    assert.equal(result.exitCode !== null || result.signal !== null, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('이번 실행에 연결된 새 XML만 복사하고 집계한다', () => {
  const root = workspace('evidence');
  const xmlDirectory = join(root, 'app', 'build', 'test-results', 'test');
  const run = join(root, '.dev-cycle', 'runs', 'one');
  try {
    mkdirSync(xmlDirectory, { recursive: true });
    const xml = join(xmlDirectory, 'TEST-App.xml');
    writeFileSync(xml, '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>');
    const before = snapshotTestEvidence(root, ['app']);
    writeFileSync(xml, '<testsuite tests="3" failures="1" errors="0" skipped="1"></testsuite>');
    const result = collectTestEvidence(root, ['app'], before, {
      started: true, exitCode: 1, signal: null, error: null, interrupted: false, cleanupError: null,
      stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false },
      tasks: [{ task: ':app:test', outcome: 'FAILED' }],
    }, run);
    assert.deepEqual(result.counts, { tests: 3, failures: 1, errors: 0, skipped: 1 });
    assert.equal(result.files[0]?.state, 'fresh');
    assert.equal(existsSync(join(run, result.files[0]!.copiedPath!)), true);

    const stale = collectTestEvidence(root, ['app'], snapshotTestEvidence(root, ['app']), {
      started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
      stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false }, tasks: [{ task: ':app:test', outcome: 'UP-TO-DATE' }],
    }, join(root, '.dev-cycle', 'runs', 'two'));
    assert.equal(stale.counts, null);
    assert.equal(stale.files[0]?.state, 'stale');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('정상 XML과 잘못된 새 XML이 섞이면 부분 합계를 전체 결과로 표시하지 않는다', () => {
  const root = workspace('mixed evidence');
  const directory = join(root, 'app', 'build', 'test-results', 'test');
  try {
    mkdirSync(directory, { recursive: true });
    const before = snapshotTestEvidence(root, ['app']);
    writeFileSync(join(directory, 'TEST-valid.xml'), '<testsuite tests="2" failures="1" errors="0" skipped="0"></testsuite>');
    writeFileSync(join(directory, 'TEST-invalid.xml'), '<testsuite tests="99" failures="0">');
    const result = collectTestEvidence(root, ['app'], before, {
      started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
      stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false },
      tasks: [{ task: ':app:test', outcome: 'EXECUTED' }],
    }, join(root, 'run'));
    assert.equal(result.files.some((file) => file.state === 'fresh'), true);
    assert.equal(result.files.some((file) => file.state === 'untrusted'), true);
    assert.equal(result.counts, null);
    assert.match(result.warnings.join('\n'), /부분 합계/u);
    assert.equal(result.hasFailures, true, '불완전한 합계도 이미 확인한 실패를 숨기지 않습니다.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Gradle XML의 구조, 속성과 엔터티를 보수적으로 검증한다', () => {
  const cases: { name: string; xml: string; expected: { tests: number; failures: number; errors: number; skipped: number } | null }[] = [
    { name: 'mismatched-end', xml: '<testsuite tests="1" failures="0" errors="0" skipped="0"><testcase></failure></testsuite>', expected: null },
    { name: 'prefixed-count', xml: '<testsuite x-tests="1" failures="0" errors="0" skipped="0"></testsuite>', expected: null },
    { name: 'unknown-entity', xml: '<testsuite tests="1" failures="0" errors="0" skipped="0" name="a &unknown;"></testsuite>', expected: null },
    { name: 'duplicate-attribute', xml: '<testsuite tests="1" tests="1" failures="0" errors="0" skipped="0"></testsuite>', expected: null },
    {
      name: 'valid-cdata-comment',
      xml: '<?xml version="1.0" encoding="UTF-8"?><testsuite tests="1" failures="0" errors="0" skipped="0" name="A &amp; B"><!-- ok --><testcase name="x &quot; y"><system-out><![CDATA[x < y & z]]></system-out></testcase></testsuite>',
      expected: { tests: 1, failures: 0, errors: 0, skipped: 0 },
    },
  ];
  for (const item of cases) {
    const root = workspace(`xml ${item.name}`);
    try {
      const directory = join(root, 'build', 'test-results', 'test');
      const before = snapshotTestEvidence(root, []);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'TEST-root.xml'), item.xml);
      const result = collectTestEvidence(root, [], before, {
        started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
        stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false },
        tasks: [{ task: ':test', outcome: 'EXECUTED' }],
      }, join(root, 'run'));
      assert.deepEqual(result.counts, item.expected, item.name);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('잘못된 UTF-8 XML 바이트를 대체 문자로 복구해 집계하지 않는다', () => {
  const root = workspace('invalid utf8');
  try {
    const directory = join(root, 'build', 'test-results', 'test');
    const before = snapshotTestEvidence(root, []);
    mkdirSync(directory, { recursive: true });
    const prefix = Buffer.from('<testsuite tests="1" failures="0" errors="0" skipped="0" name="', 'utf8');
    const suffix = Buffer.from('"></testsuite>', 'utf8');
    writeFileSync(join(directory, 'TEST-invalid-utf8.xml'), Buffer.concat([prefix, Buffer.from([0xc3, 0x28]), suffix]));
    const result = collectTestEvidence(root, [], before, {
      started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
      stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false }, tasks: [{ task: ':test', outcome: 'EXECUTED' }],
    }, join(root, 'run'));
    assert.equal(result.counts, null);
    assert.equal(result.files[0]?.state, 'untrusted');
    assert.match(result.warnings.join('\n'), /XML 형식/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('모듈 build 증거는 정확히 해당 모듈 task에만 연결한다', () => {
  const root = workspace('module evidence mapping');
  try {
    const rootDirectory = join(root, 'build', 'test-results', 'test');
    const moduleDirectory = join(root, 'build-tools', 'build', 'test-results', 'test');
    const before = snapshotTestEvidence(root, ['build-tools']);
    mkdirSync(rootDirectory, { recursive: true });
    mkdirSync(moduleDirectory, { recursive: true });
    writeFileSync(join(rootDirectory, 'TEST-root.xml'), '<testsuite tests="2" failures="0" errors="0" skipped="0"></testsuite>');
    writeFileSync(join(moduleDirectory, 'TEST-module.xml'), '<testsuite tests="3" failures="0" errors="0" skipped="0"></testsuite>');
    const result = collectTestEvidence(root, ['build-tools'], before, {
      started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
      stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false },
      tasks: [{ task: ':build-tools:test', outcome: 'EXECUTED' }],
    }, join(root, 'run'));
    assert.deepEqual(result.counts, { tests: 3, failures: 0, errors: 0, skipped: 0 });
    assert.equal(result.files.find((file) => file.path.startsWith('build/'))?.state, 'untrusted');
    assert.equal(result.files.find((file) => file.path.startsWith('build-tools/'))?.state, 'fresh');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('여러 XML의 안전 정수 합계가 넘치면 합계를 제공하지 않는다', () => {
  const root = workspace('count overflow');
  try {
    const directory = join(root, 'build', 'test-results', 'test');
    const before = snapshotTestEvidence(root, []);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'TEST-large.xml'), '<testsuite tests="9007199254740991" failures="0" errors="0" skipped="0"></testsuite>');
    writeFileSync(join(directory, 'TEST-one.xml'), '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>');
    const result = collectTestEvidence(root, [], before, {
      started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
      stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false }, tasks: [{ task: ':test', outcome: 'EXECUTED' }],
    }, join(root, 'run'));
    assert.equal(result.counts, null);
    assert.match(result.warnings.join('\n'), /안전한 정수/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('캐시 outcome, 오래된 XML과 안전하지 않은 XML을 통과 수로 추측하지 않는다', () => {
  const root = workspace('untrusted');
  const directory = join(root, 'build', 'test-results', 'test');
  try {
    mkdirSync(directory, { recursive: true });
    const xml = join(directory, 'TEST-root.xml');
    const before = snapshotTestEvidence(root, []);
    writeFileSync(xml, '<!DOCTYPE x><testsuite tests="99" failures="0" errors="0" skipped="0"></testsuite>');
    const cached = collectTestEvidence(root, [], before, {
      started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
      stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false }, tasks: [{ task: ':test', outcome: 'FROM-CACHE' }],
    }, join(root, 'run-cache'));
    assert.equal(cached.counts, null);
    assert.equal(cached.files[0]?.state, 'untrusted');

    const unsafe = collectTestEvidence(root, [], before, {
      started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
      stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false }, tasks: [{ task: ':test', outcome: 'EXECUTED' }],
    }, join(root, 'run-unsafe'));
    assert.equal(unsafe.counts, null);
    assert.match(unsafe.warnings.join('\n'), /XML 형식/u);

    for (const malformed of [
      '<testsuite tests="1" tests="1" failures="0" errors="0" skipped="0"></testsuite>',
      '<testsuite tests="1" failures="1" errors="1" skipped="0"></testsuite>',
      '<testsuite tests="1" failures="0" errors="0" skipped="0">',
    ]) {
      writeFileSync(xml, malformed);
      const rejected = collectTestEvidence(root, [], before, {
        started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
        stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false }, tasks: [{ task: ':test', outcome: 'EXECUTED' }],
      }, join(root, `run-malformed-${malformed.length}-${malformed.indexOf('tests=')}`));
      assert.equal(rejected.counts, null, malformed);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('증거 경로 이탈과 링크를 따라가지 않는다', () => {
  const root = workspace('evidence-link');
  const outside = workspace('outside');
  try {
    mkdirSync(join(root, 'app', 'build'), { recursive: true });
    symlinkSync(outside, join(root, 'app', 'build', 'test-results'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => snapshotTestEvidence(root, ['app']), /링크/u);
    assert.throws(() => snapshotTestEvidence(root, ['../outside']), /최상위 모듈/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('테스트 0개 XML과 NO-SOURCE를 새 테스트 통과로 바꾸지 않는다', () => {
  const root = workspace('zero tests');
  const directory = join(root, 'build', 'test-results', 'test');
  const execution = {
    started: true, exitCode: 0, signal: null, error: null, interrupted: false, cleanupError: null,
    stdout: { path: '', bytes: 0, truncated: false }, stderr: { path: '', bytes: 0, truncated: false },
    tasks: [{ task: ':test', outcome: 'EXECUTED' }],
  };
  try {
    const before = snapshotTestEvidence(root, []);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'TEST-empty.xml'), '<testsuite tests="0" failures="0" errors="0" skipped="0"></testsuite>');
    const zero = collectTestEvidence(root, [], before, execution, join(root, 'zero'));
    assert.deepEqual(zero.counts, { tests: 0, failures: 0, errors: 0, skipped: 0 });
    const noSource = collectTestEvidence(root, [], before, { ...execution, tasks: [{ task: ':test', outcome: 'NO-SOURCE' }] }, join(root, 'no-source'));
    assert.equal(noSource.counts, null);
    assert.equal(noSource.files[0]!.state, 'untrusted');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('POSIX 실행 기록과 증거 파일은 소유자만 접근할 수 있다', { skip: process.platform === 'win32' }, async () => {
  const root = workspace('permissions');
  const run = join(root, 'run');
  try {
    const execution = await executeTestCommand({ executable: process.execPath, args: ['-e', "console.log('> Task :test')"], cwd: root }, run);
    assert.equal(execution.exitCode, 0);
    assert.equal(statSync(run).mode & 0o777, 0o700);
    assert.equal(statSync(execution.stdout.path).mode & 0o777, 0o600);
    assert.equal(statSync(execution.stderr.path).mode & 0o777, 0o600);

    const directory = join(root, 'build', 'test-results', 'test');
    const before = snapshotTestEvidence(root, []);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'TEST-root.xml'), '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>');
    const evidence = collectTestEvidence(root, [], before, execution, run);
    const copied = join(run, evidence.files[0]!.copiedPath!);
    assert.equal(statSync(join(run, 'evidence')).mode & 0o777, 0o700);
    assert.equal(statSync(copied).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
