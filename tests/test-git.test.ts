import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { assertArtifactsDirectory, filterSourceChanges, fingerprintCode, readChanges, testRepositoryRoot } from '../src/test-git.js';
import { parseWorkflowConfig } from '../src/workflow.js';
import type { WorkflowConfig } from '../src/workflow.js';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function repository(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `dev-cycle git ${name} `));
  git(root, ['init', '--quiet', '--initial-branch=main']);
  git(root, ['config', 'user.name', 'dev-cycle test']);
  git(root, ['config', 'user.email', 'test@example.com']);
  write(join(root, 'settings.gradle'), "rootProject.name = 'sample'\ninclude 'app'\n");
  write(join(root, 'app', 'src.txt'), 'initial\n');
  write(join(root, 'README.md'), '# sample\n');
  write(join(root, 'obsolete.txt'), 'remove me\n');
  write(join(root, 'gradlew.bat'), '@echo off\r\necho test\r\n');
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'initial']);
  return root;
}

function remove(root: string): void {
  assert.equal(root.startsWith(join(tmpdir(), 'dev-cycle git ')), true, root);
  rmSync(root, { recursive: true, force: true });
}

function config(artifactsDir = '.dev-cycle'): WorkflowConfig {
  return parseWorkflowConfig({
    schemaVersion: 1,
    repository: 'example/sample',
    defaultBranch: 'main',
    baseRef: 'main',
    paths: {
      conventions: 'AGENTS.md',
      issueTemplates: '.github/ISSUE_TEMPLATE',
      prTemplate: '.github/pull_request_template.md',
    },
    commands: { test: { executable: './gradlew', args: ['test'] } },
    test: { commonModules: [], fullTestPaths: ['settings.gradle'], documentationPaths: ['README.md'] },
    artifactsDir,
  });
}

test('하위 경로에서 Git 루트를 찾고 merge-base 변경과 작업 트리 변경을 NUL 경로로 합산한다', () => {
  const root = repository('changes 공백 한글');
  try {
    const originalSettings = readFileSync(join(root, 'settings.gradle'), 'utf8');
    git(root, ['switch', '--quiet', '-c', 'feature']);
    git(root, ['mv', 'app/src.txt', 'app/renamed file.txt']);
    git(root, ['commit', '--quiet', '-m', 'rename']);
    write(join(root, 'app', 'staged 한글.txt'), 'staged\n');
    git(root, ['add', 'app/staged 한글.txt']);
    write(join(root, 'README.md'), '# changed\n');
    rmSync(join(root, 'obsolete.txt'));
    write(join(root, 'app', 'untracked space.txt'), 'untracked\n');
    mkdirSync(join(root, 'nested', 'path'), { recursive: true });

    const statusBefore = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
    assert.equal(testRepositoryRoot(join(root, 'nested', 'path')), realpathSync.native(root));
    const result = readChanges(join(root, 'nested'), 'main');

    assert.match(result.head, /^[0-9a-f]{40}$/u);
    assert.match(result.baseCommit, /^[0-9a-f]{40}$/u);
    assert.equal(result.mergeBase, result.baseCommit);
    assert.equal(result.baseSettings, originalSettings);
    assert.equal(result.changes.some((item) => item.status === 'R' && item.previousPath === 'app/src.txt' && item.path === 'app/renamed file.txt'), true);
    assert.equal(result.changes.some((item) => item.path === 'app/staged 한글.txt'), true);
    assert.equal(result.changes.some((item) => item.path === 'README.md'), true);
    assert.equal(result.changes.some((item) => item.path === 'obsolete.txt' && item.status === 'D'), true);
    assert.equal(result.changes.some((item) => item.path === 'app/untracked space.txt' && item.status === '?'), true);
    assert.equal(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), statusBefore);
  } finally { remove(root); }
});

test('Windows 8.3 별칭을 긴 Git 루트와 같은 저장소로 정규화한다', { skip: process.platform !== 'win32' }, (context) => {
  const root = repository('short path');
  try {
    const result = spawnSync('cmd.exe', ['/d', '/u', '/s', '/c', 'for %I in ("%DEV_CYCLE_TEST_PATH%") do @echo %~sI'], {
      env: { ...process.env, DEV_CYCLE_TEST_PATH: root },
      encoding: 'utf16le',
      windowsVerbatimArguments: true,
    });
    assert.equal(result.status, 0, result.stderr);
    const shortPath = result.stdout.trim();
    const canonical = realpathSync.native(root);
    if (shortPath.toLowerCase() === canonical.toLowerCase()) {
      context.skip('파일 시스템에서 이 경로의 8.3 별칭을 제공하지 않습니다.');
      return;
    }
    assert.equal(testRepositoryRoot(shortPath), canonical);
    assert.equal(readChanges(shortPath, 'main').baseSettings?.includes("include 'app'"), true);
  } finally { remove(root); }
});

test('코드 지문은 tracked, index와 관련 untracked 변경을 구분하고 생성 산출물만 제외한다', () => {
  const root = repository('fingerprint');
  try {
    const workflow = config();
    const initial = fingerprintCode(root, workflow, ['app']);

    write(join(root, '.dev-cycle', 'run.json'), '{"generated":true}\n');
    write(join(root, '.gradle', 'cache.bin'), 'cache');
    write(join(root, 'build', 'output.bin'), 'build');
    write(join(root, 'app', 'build', 'result.xml'), '<testsuite/>');
    const generated = readChanges(root, 'main').changes;
    assert.deepEqual(filterSourceChanges(root, generated, workflow, ['app']), []);
    const outputsOnly = fingerprintCode(root, workflow, ['app']);
    assert.deepEqual(outputsOnly, initial);

    write(join(root, 'app', 'new source.txt'), 'source\n');
    const untracked = fingerprintCode(root, workflow, ['app']);
    assert.notEqual(untracked.worktree, initial.worktree);
    assert.equal(untracked.index, initial.index);
    assert.equal(untracked.head, initial.head);

    git(root, ['add', 'app/new source.txt']);
    const staged = fingerprintCode(root, workflow, ['app']);
    assert.notEqual(staged.index, initial.index);
    assert.equal(staged.worktree, untracked.worktree);

    write(join(root, 'app', 'src.txt'), 'working tree changed\n');
    const modified = fingerprintCode(root, workflow, ['app']);
    assert.notEqual(modified.worktree, staged.worktree);
    assert.notEqual(modified.digest, staged.digest);
    assert.equal(modified.config, initial.config);
  } finally { remove(root); }
});

test('추적된 산출물 경로와 모듈/빌드 경로 중첩을 실행 전에 거부한다', () => {
  const root = repository('artifact collision');
  try {
    write(join(root, '.records', 'tracked.json'), '{}\n');
    git(root, ['add', '.records/tracked.json']);
    git(root, ['commit', '--quiet', '-m', 'tracked artifact']);
    assert.throws(() => assertArtifactsDirectory(root, config('.records'), ['app']), /추적 중인 파일/u);
    assert.throws(() => assertArtifactsDirectory(root, config('app/output'), ['app']), /app 경로와 겹치지/u);
    assert.throws(() => assertArtifactsDirectory(root, config('build/results'), ['app']), /build 경로와 겹치지/u);
  } finally { remove(root); }
});

test('산출물 경로의 링크와 안전하지 않거나 존재하지 않는 비교 ref를 명확히 거부한다', (context) => {
  const root = repository('errors');
  try {
    assert.throws(() => readChanges(root, '--all'), /비교 ref가 안전한 이름/u);
    assert.throws(() => readChanges(root, 'missing'), /Git 조회 실패/u);
    try {
      mkdirSync(join(root, 'external'));
      symlinkSync(join(root, 'external'), join(root, '.records'), 'junction');
    } catch (error) {
      context.diagnostic(`링크 생성 불가: ${(error as Error).message}`);
      return;
    }
    assert.throws(() => testRepositoryRoot(join(root, '.records')), /링크가 아닌 실제 디렉터리/u);
    assert.throws(() => assertArtifactsDirectory(root, config('.records'), ['app']), /심볼릭 링크\/junction/u);
  } finally { remove(root); }
});

test('추적 파일의 상위 디렉터리가 링크로 바뀌면 외부 파일을 읽지 않고 지문 생성을 중단한다', (context) => {
  const root = repository('tracked junction');
  try {
    write(join(root, 'linked', 'source.txt'), 'tracked\n');
    git(root, ['add', 'linked/source.txt']);
    git(root, ['commit', '--quiet', '-m', 'tracked linked child']);
    rmSync(join(root, 'linked'), { recursive: true, force: true });
    write(join(root, 'external', 'source.txt'), 'external secret\n');
    try {
      symlinkSync(join(root, 'external'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      context.diagnostic(`링크 생성 불가: ${(error as Error).message}`);
      return;
    }
    assert.throws(() => fingerprintCode(root, config(), ['app']), /심볼릭 링크\/junction/u);
  } finally { remove(root); }
});

test('UTF-8로 표현할 수 없는 Git 파일 이름은 서로 같은 경로로 대체하지 않고 분석을 중단한다', { skip: process.platform === 'win32' }, () => {
  const root = repository('invalid utf8');
  try {
    const path = Buffer.concat([Buffer.from(`${root}${sep}invalid-`), Buffer.from([0xff])]);
    writeFileSync(path, 'invalid name\n');
    git(root, ['add', '-A']);
    assert.throws(() => readChanges(root, 'main'), /UTF-8이 아니어서/u);
  } finally { remove(root); }
});

test('상속된 Git index, config와 trace 설정이 조회 대상을 바꾸거나 파일을 만들지 못한다', () => {
  const root = repository('git environment');
  const trace = join(root, 'trace.json');
  const overrides: Record<string, string> = {
    GIT_INDEX_FILE: join(root, 'other-index'),
    GIT_TRACE2_EVENT: trace,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'failing-monitor-command',
  };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  try {
    assert.equal(git(root, ['status', '--porcelain=v1']), '', '일반 Git 설정에서는 CRLF 배치 파일이 clean이어야 합니다.');
    Object.assign(process.env, overrides);
    const changes = readChanges(root, 'main');
    const state = fingerprintCode(root, config(), ['app']);
    assert.deepEqual(changes.changes, []);
    assert.match(state.digest, /^[0-9a-f]{64}$/u);
    assert.equal(existsSync(trace), false);
    assert.equal(existsSync(join(root, 'other-index')), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    remove(root);
  }
});

test('부분 복제는 누락된 객체를 자동 다운로드하기 전에 명시적으로 거부한다', () => {
  const source = repository('promisor source');
  const clone = mkdtempSync(join(tmpdir(), 'dev-cycle git partial clone '));
  try {
    git(source, ['config', 'uploadpack.allowFilter', 'true']);
    git(source, ['clone', '--quiet', '--filter=blob:none', '--no-checkout', pathToFileURL(source).href, clone]);
    assert.equal(git(clone, ['config', '--bool', '--get', 'remote.origin.promisor']).trim(), 'true');
    const objects = join(clone, '.git', 'objects', 'pack');
    const before = readdirSync(objects).sort().map((file) => [file, readFileSync(join(objects, file)).toString('hex')]);
    assert.throws(() => readChanges(clone, 'main'), /부분 복제/u);
    assert.throws(() => fingerprintCode(clone, config(), ['app']), /부분 복제/u);
    assert.deepEqual(readdirSync(objects).sort().map((file) => [file, readFileSync(join(objects, file)).toString('hex')]), before);
    assert.equal(existsSync(join(clone, '.git', 'FETCH_HEAD')), false);
  } finally { remove(source); remove(clone); }
});
