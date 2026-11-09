import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import fsDefault from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { runReport } from '../src/report.js';
import { runTest } from '../src/test.js';

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

function config(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    repository: 'example/report-fixture',
    defaultBranch: 'main',
    baseRef: 'HEAD',
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
      commonModules: [],
      fullTestPaths: ['settings.gradle', 'build.gradle', 'gradlew', 'gradlew.bat'],
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
const moduleName = match?.[1] ?? '';
if (mode === 'change-during') fs.appendFileSync('app/src/Main.java', '// changed by runner\\n');
if (mode === 'fail') {
  console.log('> Task ' + task + ' FAILED');
  process.exitCode = 5;
} else if (mode === 'cached') {
  console.log('> Task ' + task + ' UP-TO-DATE');
} else {
  const directory = path.join(moduleName, 'build', 'test-results', 'test');
  fs.mkdirSync(directory, { recursive: true });
  const counts = mode === 'zero' ? 'tests="0" failures="0" errors="0" skipped="0"' : 'tests="3" failures="0" errors="0" skipped="1"';
  fs.writeFileSync(path.join(directory, 'TEST-report.xml'), '<testsuite ' + counts + '></testsuite>');
  console.log('> Task ' + task);
}
`;

function repository(mode = 'success'): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'dev-cycle report 한글 ')));
  temporary.push(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Report Test']);
  git(root, ['config', 'user.email', 'report@example.test']);
  write(join(root, 'settings.gradle'), "rootProject.name = 'fixture'\ninclude 'app'\n");
  write(join(root, 'dev-cycle.config.json'), `${JSON.stringify(config(), null, 2)}\n`);
  write(join(root, '.gitignore'), '.dev-cycle/\n.gradle/\nbuild/\n**/build/\n');
  write(join(root, '.stub-mode'), `${mode}\n`);
  write(join(root, 'README.md'), '# fixture\n');
  write(join(root, 'app/src/Main.java'), 'class Main {}\n');
  write(join(root, 'gradlew'), runner);
  fs.chmodSync(join(root, 'gradlew'), 0o755);
  write(join(root, 'gradlew.bat'), '@echo off\nnode "%~dp0gradlew" %*\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
  return root;
}

async function execute(root: string) {
  fs.appendFileSync(join(root, 'app/src/Main.java'), '// changed\n');
  const result = await runTest({ target: root });
  assert.ok(result.recordPath && result.runId, JSON.stringify(result));
  return result;
}

test('기록이 없으면 테스트를 실행하지 않았음을 표시하고 성공이나 수치를 추측하지 않는다', () => {
  const root = repository();
  const result = runReport({ target: root });
  assert.equal(result.status, 'not-run');
  assert.equal(result.exitCode, 0);
  assert.equal(result.run, null);
  assert.equal(result.freshness, null);
  assert.match(result.markdown, /실행하지 않았/u);
  assert.doesNotMatch(result.markdown, /통과|성공|tests=/u);
  assert.equal(fs.existsSync(join(root, '.dev-cycle')), false);
});

test('현재 성공 기록의 명령, 선정 이유와 확인된 XML 수치만 Markdown과 JSON에 반영한다', async () => {
  const root = repository();
  const run = await execute(root);
  const result = runReport({ target: root, runId: run.runId! });
  assert.equal(result.status, 'generated');
  assert.equal(result.exitCode, 0);
  assert.equal(result.run?.runId, run.runId);
  assert.equal(result.run?.status, 'succeeded');
  assert.equal(result.freshness?.status, 'current');
  assert.match(result.markdown, new RegExp(run.runId!, 'u'));
  assert.match(result.markdown, /succeeded/u);
  assert.match(result.markdown, /:app:test/u);
  assert.match(result.markdown, /tests[^\n]*3/u);
  assert.match(result.markdown, /failures[^\n]*0/u);
});

test('테스트 이후 tracked, staged, untracked 변경은 현재 코드를 검증한 것으로 표시하지 않는다', async (context) => {
  const root = repository();
  write(join(root, 'local-note.txt'), 'before\n');
  const run = await execute(root);
  const source = fs.readFileSync(join(root, 'app/src/Main.java'), 'utf8');
  const changes: [string, () => void, () => void][] = [
    ['tracked', () => fs.appendFileSync(join(root, 'app/src/Main.java'), '// later\n'), () => fs.writeFileSync(join(root, 'app/src/Main.java'), source)],
    ['staged', () => {
      fs.appendFileSync(join(root, 'app/src/Main.java'), '// staged\n');
      git(root, ['add', 'app/src/Main.java']);
    }, () => {
      fs.writeFileSync(join(root, 'app/src/Main.java'), source);
      git(root, ['restore', '--staged', 'app/src/Main.java']);
    }],
    ['untracked content', () => fs.writeFileSync(join(root, 'local-note.txt'), 'after\n'), () => fs.writeFileSync(join(root, 'local-note.txt'), 'before\n')],
    ['deleted', () => fs.rmSync(join(root, 'app/src/Main.java')), () => fs.writeFileSync(join(root, 'app/src/Main.java'), source)],
    ['renamed', () => git(root, ['mv', 'app/src/Main.java', 'app/src/Renamed.java']), () => git(root, ['mv', 'app/src/Renamed.java', 'app/src/Main.java'])],
  ];
  for (const [name, change, restore] of changes) {
    await context.test(name, async () => {
      change();
      const result = runReport({ target: root, runId: run.runId! });
      assert.equal(result.freshness?.status, 'changed');
      assert.match(result.markdown, /현재 코드를 검증하지 않/u);
      restore();
    });
  }
  await context.test('current config override', () => {
    const alternate = join(root, 'alternate-config.json');
    write(alternate, `${JSON.stringify({ ...config(), repository: 'example/changed-config' }, null, 2)}\n`);
    assert.equal(runReport({ target: root, runId: run.runId!, configPath: alternate }).freshness?.status, 'changed');
  });
  await context.test('HEAD', () => {
    git(root, ['add', 'app/src/Main.java']);
    git(root, ['commit', '-m', 'later commit']);
    assert.equal(runReport({ target: root, runId: run.runId! }).freshness?.status, 'changed');
  });
});

test('실패한 최신 기록을 과거 성공으로 가리지 않는다', async () => {
  const root = repository();
  const succeeded = await execute(root);
  fs.writeFileSync(join(root, '.stub-mode'), 'fail\n');
  const failed = await runTest({ target: root });
  assert.equal(failed.status, 'failed');
  const result = runReport({ target: root });
  assert.notEqual(result.run?.runId, succeeded.runId);
  assert.equal(result.run?.runId, failed.runId);
  assert.equal(result.run?.status, 'failed');
  assert.match(result.markdown, /failed/u);
  assert.match(result.markdown, /5/u);
});

test('캐시 결과와 0개 테스트를 확인된 테스트 통과로 바꾸지 않는다', async (context) => {
  await context.test('cache', async () => {
    const root = repository('cached');
    const run = await execute(root);
    assert.equal(run.evidence?.counts, null);
    const result = runReport({ target: root });
    assert.match(result.markdown, /확인되지 않/u);
    assert.doesNotMatch(result.markdown, /[1-9][0-9]*개 통과/u);
  });
  await context.test('zero', async () => {
    const root = repository('zero');
    const run = await execute(root);
    assert.equal(run.evidence?.counts?.tests, 0);
    const result = runReport({ target: root });
    assert.match(result.markdown, /tests[^\n]*0/u);
    assert.doesNotMatch(result.markdown, /[1-9][0-9]*개 통과|모든 테스트가 통과/u);
  });
});

test('미완료 journal은 성공이 아니라 중단과 불완전 상태로 보고한다', async () => {
  const root = repository();
  const run = await execute(root);
  const record = JSON.parse(fs.readFileSync(run.recordPath!, 'utf8')) as Record<string, unknown>;
  record.status = 'running';
  record.endedAt = null;
  record.after = null;
  record.codeState = 'unknown';
  record.execution = null;
  record.evidence = null;
  record.exitCode = 0;
  fs.writeFileSync(run.recordPath!, `${JSON.stringify(record, null, 2)}\n`);
  const result = runReport({ target: root, runId: run.runId! });
  assert.equal(result.run?.status, 'interrupted');
  assert.equal(result.freshness?.status, 'incomplete');
  assert.match(result.markdown, /interrupted|중단/u);
  assert.doesNotMatch(result.markdown, /현재 코드[^\n]*검증(됨|했습니다)/u);
});

test('실행 중 코드 변경, 문서 생략과 프로세스 시작 실패를 그대로 보고한다', async (context) => {
  await context.test('changed during execution', async () => {
    const root = repository('change-during');
    const run = await execute(root);
    assert.equal(run.codeState, 'changed');
    const result = runReport({ target: root });
    assert.equal(result.freshness?.status, 'changed');
    assert.match(result.markdown, /현재 코드를 검증하지 않/u);
  });
  await context.test('document skip', async () => {
    const root = repository();
    fs.appendFileSync(join(root, 'README.md'), 'docs only\n');
    const run = await runTest({ target: root });
    assert.equal(run.status, 'skipped');
    const result = runReport({ target: root });
    assert.equal(result.run?.status, 'skipped');
    assert.match(result.markdown, /실행하지 않았|생략/u);
    assert.doesNotMatch(result.markdown, /모든 테스트가 통과/u);
  });
  await context.test('spawn not-run', async () => {
    const root = repository();
    fs.appendFileSync(join(root, 'app/src/Main.java'), '// changed\n');
    fs.rmSync(join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'));
    const run = await runTest({ target: root });
    assert.equal(run.status, 'not-run');
    const result = runReport({ target: root });
    assert.equal(result.run?.status, 'not-run');
    assert.match(result.markdown, /실행하지 않았/u);
  });
});

test('손상되거나 지원하지 않는 후보 기록이 있으면 과거 성공으로 fallback하지 않는다', async (context) => {
  const root = repository();
  const valid = await execute(root);
  const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const path = join(root, '.dev-cycle', 'runs', id, 'record.json');
  fs.mkdirSync(join(path, '..'), { recursive: true });
  await context.test('missing record', () => {
    const result = runReport({ target: root });
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 2);
  });
  for (const [name, content] of [
    ['corrupt', '{'],
    ['unsupported', JSON.stringify({ schemaVersion: 2, command: 'test' })],
  ] as const) {
    await context.test(name, () => {
      write(path, content);
      const result = runReport({ target: root });
      assert.equal(result.status, 'failed');
      assert.equal(result.exitCode, 2);
      assert.equal(result.run, null);
      assert.ok(result.errors.length > 0);
    });
  }
  await context.test('explicit valid run ignores unrelated invalid candidate', () => {
    const result = runReport({ target: root, runId: valid.runId! });
    assert.equal(result.status, 'generated');
    assert.equal(result.run?.runId, valid.runId);
  });
});

test('다른 저장소 경로를 주장하는 기록과 없는 명시 run ID를 거부한다', async (context) => {
  await context.test('wrong root', async () => {
    const root = repository();
    const run = await execute(root);
    const record = JSON.parse(fs.readFileSync(run.recordPath!, 'utf8')) as Record<string, unknown>;
    const selection = record.selection as { reasons: string[] };
    selection.reasons = ['<script>alert(1)</script> | unsafe'];
    fs.writeFileSync(run.recordPath!, `${JSON.stringify(record, null, 2)}\n`);
    const escaped = runReport({ target: root, runId: run.runId! });
    assert.match(escaped.markdown, /&lt;script&gt;/u);
    assert.doesNotMatch(escaped.markdown, /<script>/u);
    record.root = join(root, 'other');
    fs.writeFileSync(run.recordPath!, `${JSON.stringify(record, null, 2)}\n`);
    const result = runReport({ target: root, runId: run.runId! });
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 2);
  });
  await context.test('missing run ID', () => {
    const root = repository();
    const result = runReport({ target: root, runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 2);
  });
});

test('보고서 파일은 관리 경로에만 새로 쓰고 기존 파일과 링크 경로를 보존한다', async (context) => {
  const root = repository();
  const run = await execute(root);
  await context.test('dry-run', () => {
    const result = runReport({ target: root, runId: run.runId!, outputPath: '.dev-cycle/reports/dry.md', dryRun: true });
    assert.equal(result.status, 'generated');
    assert.equal(fs.existsSync(join(root, '.dev-cycle', 'reports', 'dry.md')), false);
  });
  await context.test('outside and symlink', () => {
    assert.equal(runReport({ target: root, runId: run.runId!, outputPath: 'outside.md' }).status, 'failed');
    const external = fs.mkdtempSync(join(tmpdir(), 'dev-cycle report external '));
    temporary.push(external);
    fs.mkdirSync(join(root, '.dev-cycle', 'reports'), { recursive: true });
    fs.symlinkSync(external, join(root, '.dev-cycle', 'reports', 'linked'), 'junction');
    const linked = runReport({ target: root, runId: run.runId!, outputPath: '.dev-cycle/reports/linked/pr.md' });
    assert.equal(linked.status, 'failed');
    assert.equal(fs.existsSync(join(external, 'pr.md')), false);
  });
  await context.test('write and no pollution', async () => {
    const first = runReport({ target: root, runId: run.runId!, outputPath: '.dev-cycle/reports/pr.md' });
    assert.equal(first.status, 'generated');
    assert.equal(first.outputPath, join(root, '.dev-cycle', 'reports', 'pr.md'));
    assert.equal(fs.readFileSync(first.outputPath!, 'utf8'), first.markdown);
    assert.equal(runReport({ target: root, runId: run.runId! }).freshness?.status, 'current');
    const repeated = runReport({ target: root, runId: run.runId!, outputPath: '.dev-cycle/reports/pr.md' });
    assert.equal(repeated.status, 'failed');
    assert.equal(repeated.exitCode, 2);
    assert.equal(fs.readFileSync(first.outputPath!, 'utf8'), first.markdown);
  });
});

test('보고서 저장 디렉터리를 준비하는 사이 코드가 바뀌면 쓰기 직전 신선도를 다시 판정한다', async (context) => {
  const root = repository();
  const run = await execute(root);
  const reports = join(root, '.dev-cycle', 'reports');
  const originalMkdir = fsDefault.mkdirSync.bind(fsDefault) as typeof fsDefault.mkdirSync;
  let changed = false;
  context.mock.method(fsDefault, 'mkdirSync', ((path: fs.PathLike, options?: unknown) => {
    const value = originalMkdir(path, options as never);
    if (path === reports) {
      changed = true;
      fs.appendFileSync(join(root, 'app/src/Main.java'), '// changed while preparing report\n');
    }
    return value;
  }) as typeof fsDefault.mkdirSync);
  syncBuiltinESMExports();
  let result;
  try { result = runReport({ target: root, runId: run.runId!, outputPath: '.dev-cycle/reports/race.md' }); }
  finally { context.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(changed, true);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.freshness?.status, 'changed');
  assert.match(fs.readFileSync(result.outputPath!, 'utf8'), /현재 코드를 검증하지 않/u);
});

test('프로세스와 증거가 모순된 기록은 테스트 수를 출력하지 않고 오류로 보고한다', async () => {
  const root = repository();
  const run = await execute(root);
  assert.ok(run.evidence);
  const invalid = { ...run, status: 'failed', exitCode: 2, execution: null,
    errors: ['corrupted evidence'], evidence: { ...run.evidence, files: [], counts: { tests: 999, failures: 0, errors: 0, skipped: 0 } } };
  fs.writeFileSync(run.recordPath!, JSON.stringify(invalid));
  const report = runReport({ target: root });
  assert.equal(report.status, 'failed');
  assert.equal(report.run, null);
  assert.doesNotMatch(report.markdown, /999/u);
});

test('생산된 기록에 report만의 크기 제한을 적용하지 않는다', async () => {
  const root = repository();
  const run = await execute(root);
  // A large recorded diagnostic remains valid V1 data; no arbitrary consumer-only limit.
  run.warnings.push('large diagnostic '.repeat(280000));
  fs.writeFileSync(run.recordPath!, JSON.stringify(run));
  const report = runReport({ target: root });
  assert.equal(report.status, 'generated', report.errors.join('\n'));
  assert.equal(report.run?.runId, run.runId);
});
