import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fsDefault from 'node:fs';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { runInit } from '../src/init.js';

const example = JSON.parse(readFileSync('examples/dev-cycle.config.json', 'utf8')) as Record<string, unknown>;
const manifest = JSON.parse(readFileSync('templates/manifest.json', 'utf8')) as {
  files: { source: string; target: string }[];
};

function temporaryWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `dev-cycle init ${name} `));
}

function initializeGit(path: string): void {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: path, stdio: 'pipe' });
}

function writeJson(path: string, value: unknown, spaces = 2): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, spaces)}\n`);
}

function repositorySnapshot(root: string): string[] {
  function visit(path: string): string[] {
    return readdirSync(path).flatMap((name) => {
      const absolute = join(path, name);
      const item = lstatSync(absolute);
      const key = relative(root, absolute).split(sep).join('/');
      if (item.isSymbolicLink()) return [`link:${key}:${readlinkSync(absolute)}`];
      if (item.isDirectory()) return [`dir:${key}`, ...visit(absolute)];
      return [`file:${key}:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`];
    });
  }
  return visit(root).sort();
}

function gitStatus(root: string): string {
  return execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
}

function removeWorkspace(path: string): void {
  assert.equal(path.startsWith(join(tmpdir(), 'dev-cycle init ')), true, path);
  rmSync(path, { recursive: true, force: true });
}

test('첫 커밋이 없는 공백/한글 경로 저장소에 manifest 파일만 설치하고 재실행은 기존 바이트를 보존한다', () => {
  const workspace = temporaryWorkspace('빈 저장소 한글');
  try {
    const root = join(workspace, '대상 저장소');
    const nested = join(root, 'project path', 'nested');
    initializeGit(root);
    mkdirSync(nested, { recursive: true });
    const config = structuredClone(example);
    config.commands = {
      test: { executable: 'C:/Program Files/runner.exe', args: ['a b', '한글', '$()', '&', '"quoted"', ''] },
    };
    writeJson(join(workspace, '설정 파일.json'), config);

    const first = runInit({ cwd: workspace, target: relative(workspace, nested), configPath: '설정 파일.json' });
    assert.equal(first.exitCode, 0, first.errors.join('\n'));
    assert.equal(first.status, 'completed');
    assert.equal(first.root, fsDefault.realpathSync.native(root));
    assert.deepEqual(first.files.map((file) => file.path).sort(), manifest.files.map((file) => file.target).sort());
    assert.equal(first.files.every((file) => file.status === 'created'), true);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'dev-cycle.config.json'), 'utf8')), first.config);
    assert.deepEqual(
      (JSON.parse(readFileSync(join(root, 'dev-cycle.config.json'), 'utf8')) as typeof example).commands,
      config.commands,
    );

    const afterFirst = repositorySnapshot(root);
    const second = runInit({ cwd: nested });
    assert.equal(second.exitCode, 0, second.errors.join('\n'));
    assert.equal(second.status, 'completed');
    assert.equal(second.files.every((file) => file.status === 'unchanged'), true);
    assert.deepEqual(repositorySnapshot(root), afterFirst);

    const renderedIgnore = readFileSync(join(root, '.gitignore'), 'utf8');
    const manuallyMergedIgnore = `# Existing project rules\r\nbuild/\r\n\r\n${renderedIgnore.replaceAll('\n', '\r\n')}`;
    writeFileSync(join(root, '.gitignore'), manuallyMergedIgnore);
    const third = runInit({ cwd: nested });
    assert.equal(third.exitCode, 0, third.errors.join('\n'));
    assert.equal(third.files.find((file) => file.path === '.gitignore')?.status, 'unchanged');
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), manuallyMergedIgnore);
    const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
      cwd: root,
      input: '.dev-cycle/run.json\n.claude/settings.local.json\n.claude/claude-progress.txt\n.claude/feature_list.json\n.claude/logs/run.jsonl\n',
      encoding: 'utf8',
    });
    assert.equal(ignored.trim().split(/\r?\n/u).length, 5);

    const installed = JSON.parse(readFileSync(join(root, 'dev-cycle.config.json'), 'utf8')) as Record<string, unknown>;
    writeJson(join(root, 'dev-cycle.config.json'), installed, 4);
    const reformatted = readFileSync(join(root, 'dev-cycle.config.json'));
    const fourth = runInit({ cwd: nested });
    assert.equal(fourth.exitCode, 0, fourth.errors.join('\n'));
    assert.equal(fourth.files.find((file) => file.path === 'dev-cycle.config.json')?.status, 'unchanged');
    assert.deepEqual(readFileSync(join(root, 'dev-cycle.config.json')), reformatted);

    const unsafeNegation = `${manuallyMergedIgnore}!/.dev-cycle/keep.json\r\n`;
    writeFileSync(join(root, '.gitignore'), unsafeNegation);
    const fifth = runInit({ cwd: nested });
    assert.equal(fifth.status, 'blocked');
    assert.equal(fifth.exitCode, 1);
    assert.equal(fifth.files.find((file) => file.path === '.gitignore')?.status, 'conflict');
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), unsafeNegation);
  } finally {
    removeWorkspace(workspace);
  }
});

test('dry-run은 반복해도 대상 파일, Git 내부 상태와 출력 계획을 바꾸지 않는다', () => {
  const workspace = temporaryWorkspace('dry run');
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    writeJson(join(workspace, 'input.json'), example);
    const before = repositorySnapshot(root);
    const statusBefore = gitStatus(root);

    const first = runInit({ cwd: workspace, target: 'target', configPath: 'input.json', dryRun: true });
    const second = runInit({ cwd: workspace, target: 'target', configPath: 'input.json', dryRun: true });
    assert.equal(first.status, 'ready');
    assert.equal(first.exitCode, 0);
    assert.equal(first.files.every((file) => file.status === 'create'), true);
    assert.deepEqual(second, first);
    assert.deepEqual(repositorySnapshot(root), before);
    assert.equal(gitStatus(root), statusBefore);
  } finally {
    removeWorkspace(workspace);
  }
});

test('Windows 8.3 별칭과 긴 Git 루트를 같은 디렉터리로 처리한다', { skip: process.platform !== 'win32' }, (context) => {
  const workspace = temporaryWorkspace('short path');
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    writeJson(join(workspace, 'input.json'), example);
    const shortResult = spawnSync('cmd.exe', ['/d', '/u', '/s', '/c', 'for %I in ("%DEV_CYCLE_TEST_PATH%") do @echo %~sI'], {
      env: { ...process.env, DEV_CYCLE_TEST_PATH: root }, encoding: 'utf16le', windowsVerbatimArguments: true,
    });
    assert.equal(shortResult.status, 0, shortResult.stderr);
    const shortPath = shortResult.stdout.trim();
    const canonical = fsDefault.realpathSync.native(root);
    if (shortPath.toLowerCase() === canonical.toLowerCase()) {
      context.skip('파일 시스템에서 이 경로의 8.3 별칭을 제공하지 않습니다.');
      return;
    }
    const before = repositorySnapshot(root);
    const options = { cwd: workspace, target: shortPath, configPath: 'input.json' };
    const preview = runInit({ ...options, dryRun: true });
    assert.equal(preview.status, 'ready', preview.errors.join('\n'));
    assert.equal(preview.root, canonical);
    assert.deepEqual(repositorySnapshot(root), before);
    assert.equal(runInit(options).status, 'completed');
    const repeated = runInit({ cwd: root });
    assert.equal(repeated.status, 'completed', repeated.errors.join('\n'));
    assert.equal(repeated.root, canonical);
  } finally { removeWorkspace(workspace); }
});

test('dry-run은 상속한 Git trace 환경과 전역 trace2 설정으로도 로그를 생성하지 않는다', () => {
  const workspace = temporaryWorkspace('trace settings');
  const previousTrace = process.env.GIT_TRACE;
  const previousEvent = process.env.GIT_TRACE2_EVENT;
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    writeJson(join(workspace, 'input.json'), example);
    const configHome = join(workspace, 'isolated-config');
    mkdirSync(join(configHome, 'git'), { recursive: true });
    execFileSync('git', ['config', '--file', join(configHome, 'git/config'), 'trace2.eventTarget', join(root, 'config-trace.jsonl')], { cwd: root, stdio: 'pipe' });
    const before = repositorySnapshot(root);
    process.env.GIT_TRACE = join(root, 'env-trace.log');
    process.env.GIT_TRACE2_EVENT = join(root, 'env-trace.jsonl');
    process.env.XDG_CONFIG_HOME = configHome;
    const options = { cwd: workspace, target: 'target', configPath: 'input.json', dryRun: true };
    const environment = runInit(options);
    assert.equal(environment.status, 'ready', environment.errors.join('\n'));
    assert.deepEqual(repositorySnapshot(root), before);
    delete process.env.GIT_TRACE;
    delete process.env.GIT_TRACE2_EVENT;
    const configured = runInit(options);
    assert.equal(configured.status, 'ready', configured.errors.join('\n'));
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    if (previousTrace === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = previousTrace;
    if (previousEvent === undefined) delete process.env.GIT_TRACE2_EVENT; else process.env.GIT_TRACE2_EVENT = previousEvent;
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfigHome;
    removeWorkspace(workspace);
  }
});

test('Windows의 소문자 Git 환경변수가 대상 저장소 조회를 바꾸지 않는다', { skip: process.platform !== 'win32' }, () => {
  const workspace = temporaryWorkspace('git environment');
  const names = ['git_dir', 'git_work_tree', 'git_index_file'];
  const previous = Object.entries(process.env).filter(([key]) => names.includes(key.toLowerCase()));
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    writeJson(join(workspace, 'input.json'), example);
    const before = repositorySnapshot(root);
    for (const [key] of previous) delete process.env[key];
    for (const name of names) process.env[name] = join(workspace, 'wrong-repository');
    const result = runInit({ cwd: workspace, target: 'target', configPath: 'input.json', dryRun: true });
    assert.equal(result.status, 'ready', result.errors.join('\n'));
    assert.equal(result.root, fsDefault.realpathSync.native(root));
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    for (const name of names) delete process.env[name];
    for (const [key, value] of previous) process.env[key] = value;
    removeWorkspace(workspace);
  }
});

test('상속한 Git 탐색 제한이 하위 디렉터리에서 저장소 루트를 숨기지 않는다', () => {
  const workspace = temporaryWorkspace('discovery environment');
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    mkdirSync(join(root, 'nested'));
    writeJson(join(workspace, 'input.json'), example);
    const before = repositorySnapshot(root);
    process.env.GIT_CEILING_DIRECTORIES = root;
    const result = runInit({ cwd: workspace, target: 'target/nested', configPath: 'input.json', dryRun: true });
    assert.equal(result.status, 'ready', result.errors.join('\n'));
    assert.equal(result.root, fsDefault.realpathSync.native(root));
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previous;
    removeWorkspace(workspace);
  }
});

test('첫 설치 전에도 하위 Git 제외 규칙의 예외를 검사하고 어떤 파일도 쓰지 않는다', () => {
  const workspace = temporaryWorkspace('nested ignore');
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    writeJson(join(workspace, 'input.json'), example);
    mkdirSync(join(root, '.claude'));
    for (const rule of ['!settings.local.json', '!logs/']) {
      writeFileSync(join(root, '.claude/.gitignore'), `${rule}\n`);
      const before = repositorySnapshot(root);
      for (const dryRun of [true, false]) {
        const result = runInit({ cwd: workspace, target: 'target', configPath: 'input.json', dryRun });
        assert.equal(result.status, 'failed', rule);
        assert.equal(result.exitCode, 2);
        assert.match(result.errors.join('\n'), /\.claude.*예외/u);
        assert.deepEqual(repositorySnapshot(root), before);
      }
    }
    // A lower-priority exclude rule must not block the root rules that will be installed.
    writeFileSync(join(root, '.claude/.gitignore'), 'scratch/\n\\!literal\n/!literal\n');
    writeFileSync(join(root, '.git/info/exclude'), '!.claude/settings.local.json\n');
    // Rules inside an excluded directory cannot bring its children back into the work tree.
    mkdirSync(join(root, '.dev-cycle'));
    writeFileSync(join(root, '.dev-cycle/.gitignore'), '!run.json\n');
    mkdirSync(join(root, '.claude/logs'));
    writeFileSync(join(root, '.claude/logs/.gitignore'), '!run.jsonl\n');
    const installed = runInit({ cwd: workspace, target: 'target', configPath: 'input.json' });
    assert.equal(installed.status, 'completed', installed.errors.join('\n'));
    const repeated = runInit({ cwd: root });
    assert.equal(repeated.status, 'completed', repeated.errors.join('\n'));
  } finally { removeWorkspace(workspace); }
});

test('Git checkout이 CRLF로 바꾼 공유 텍스트는 다시 쓰지 않고 유지한다', () => {
  const workspace = temporaryWorkspace('line endings');
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    writeJson(join(workspace, 'input.json'), example);
    assert.equal(runInit({ cwd: workspace, target: 'target', configPath: 'input.json' }).exitCode, 0);
    for (const file of manifest.files) {
      const path = join(root, file.target);
      writeFileSync(path, readFileSync(path, 'utf8').replace(/\r?\n/gu, '\r\n'));
    }
    const before = repositorySnapshot(root);
    const result = runInit({ cwd: root });
    assert.equal(result.status, 'completed', result.errors.join('\n'));
    assert.equal(result.files.every((file) => file.status === 'unchanged'), true);
    assert.deepEqual(repositorySnapshot(root), before);
  } finally { removeWorkspace(workspace); }
});

test('명시한 빈 API 경로는 기본 설정이나 현재 저장소로 대체하지 않는다', () => {
  const workspace = temporaryWorkspace('empty options');
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    writeJson(join(root, 'dev-cycle.config.json'), example);
    const before = repositorySnapshot(root);
    for (const key of ['target', 'configPath', 'templateDirectory'] as const) {
      const result = runInit({ cwd: root, [key]: '', dryRun: true });
      assert.equal(result.status, 'failed', key);
      assert.equal(result.exitCode, 2, key);
      assert.deepEqual(repositorySnapshot(root), before);
    }
  } finally { removeWorkspace(workspace); }
});

test('기존 Claude 설정과 gitignore 충돌은 모든 경로를 보고하고 어떤 새 파일도 만들지 않는다', () => {
  const workspace = temporaryWorkspace('conflicts');
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    writeJson(join(workspace, 'input.json'), example);
    const conflicts = [
      'CLAUDE.md',
      '.gitignore',
      '.claude/settings.json',
      '.claude/skills/issue/SKILL.md',
    ];
    for (const path of conflicts) {
      const absolute = join(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `사용자 파일: ${path}\n`);
    }
    const before = repositorySnapshot(root);

    const result = runInit({ cwd: workspace, target: 'target', configPath: 'input.json' });
    assert.equal(result.status, 'blocked');
    assert.equal(result.exitCode, 1);
    assert.deepEqual(
      result.files.filter((file) => file.status === 'conflict').map((file) => file.path).sort(),
      conflicts.sort(),
    );
    assert.equal(result.files.some((file) => file.status === 'created'), false);
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    removeWorkspace(workspace);
  }
});

test('설정 오류와 비 Git 경로는 예외 대신 실패 결과를 반환하고 파일을 쓰지 않는다', () => {
  const workspace = temporaryWorkspace('invalid inputs');
  try {
    const nonGit = join(workspace, 'plain');
    mkdirSync(nonGit);
    writeJson(join(workspace, 'bad.json'), { ...example, schemaVersion: 99 });
    const before = repositorySnapshot(workspace);

    const notRepository = runInit({ cwd: workspace, target: 'plain', configPath: 'bad.json' });
    assert.equal(notRepository.status, 'failed');
    assert.equal(notRepository.exitCode, 2);
    assert.equal(notRepository.root, null);
    assert.equal(notRepository.errors.length > 0, true);
    assert.deepEqual(repositorySnapshot(workspace), before);

    initializeGit(nonGit);
    const afterGit = repositorySnapshot(workspace);
    const invalidConfig = runInit({ cwd: workspace, target: 'plain', configPath: 'bad.json' });
    assert.equal(invalidConfig.status, 'failed');
    assert.equal(invalidConfig.exitCode, 2);
    assert.match(invalidConfig.errors.join('\n'), /schemaVersion/u);
    assert.deepEqual(repositorySnapshot(workspace), afterGit);
  } finally {
    removeWorkspace(workspace);
  }
});

test('manifest의 루트 이탈, 대소문자 중복과 파일/디렉터리 prefix 충돌을 쓰기 전에 거부한다', () => {
  const cases: [string, (value: { files: { source: string; target: string }[] }) => void][] = [
    ...['CONIN$', 'CONOUT$', 'COM¹', 'LPT²', 'COM³.txt'].map((name): [string, (value: { files: { source: string; target: string }[] }) => void] =>
      [name, (value) => { value.files[0]!.target = name; }]),
    ['source traversal', (value) => { value.files[0]!.source = '../outside'; }],
    ['target traversal', (value) => { value.files[0]!.target = '../outside'; }],
    ['absolute source', (value) => { value.files[0]!.source = 'C:/outside'; }],
    ['absolute target', (value) => { value.files[0]!.target = '/outside'; }],
    ['case collision', (value) => { value.files[1]!.target = value.files[0]!.target.toLowerCase(); }],
    ['prefix collision', (value) => { value.files[1]!.target = `${value.files[0]!.target}/child`; }],
  ];

  for (const [name, mutate] of cases) {
    const workspace = temporaryWorkspace('manifest');
    try {
      const root = join(workspace, 'target');
      initializeGit(root);
      writeJson(join(workspace, 'input.json'), example);
      cpSync(resolve('templates'), join(workspace, 'templates'), { recursive: true });
      const custom = JSON.parse(readFileSync(join(workspace, 'templates/manifest.json'), 'utf8')) as {
        files: { source: string; target: string }[];
      };
      mutate(custom);
      writeJson(join(workspace, 'templates/manifest.json'), custom);
      const before = repositorySnapshot(root);

      const result = runInit({
        cwd: workspace,
        target: 'target',
        configPath: 'input.json',
        templateDirectory: join(workspace, 'templates'),
      });
      assert.equal(result.status, 'failed', name);
      assert.equal(result.exitCode, 2, name);
      assert.equal(result.errors.length > 0, true, name);
      assert.deepEqual(repositorySnapshot(root), before, name);
    } finally {
      removeWorkspace(workspace);
    }
  }
});

test('대상 경로의 링크와 추적 파일이 든 결과 디렉터리를 안전하지 않은 경로로 거부한다', () => {
  const workspace = temporaryWorkspace('unsafe paths');
  try {
    const root = join(workspace, 'target');
    const outside = join(workspace, 'outside');
    initializeGit(root);
    mkdirSync(outside);
    writeJson(join(workspace, 'input.json'), example);
    symlinkSync(outside, join(root, '.claude'), process.platform === 'win32' ? 'junction' : 'dir');
    const beforeLink = repositorySnapshot(root);

    const linked = runInit({ cwd: workspace, target: 'target', configPath: 'input.json', dryRun: true });
    assert.equal(linked.status, 'failed');
    assert.equal(linked.exitCode, 2);
    assert.match(linked.errors.join('\n'), /link|symbolic|junction|링크|재분석/u);
    assert.deepEqual(repositorySnapshot(root), beforeLink);

    rmSync(join(root, '.claude'), { force: true });
    writeFileSync(join(root, 'claude.md'), 'wrong case\n');
    const beforeCase = repositorySnapshot(root);
    const caseCollision = runInit({ cwd: workspace, target: 'target', configPath: 'input.json' });
    assert.equal(caseCollision.status, 'failed');
    assert.equal(caseCollision.exitCode, 2);
    assert.match(caseCollision.errors.join('\n'), /대소문자/u);
    assert.deepEqual(repositorySnapshot(root), beforeCase);
    rmSync(join(root, 'claude.md'));

    mkdirSync(join(root, '.dev-cycle'));
    writeFileSync(join(root, '.dev-cycle', 'tracked.json'), '{}\n');
    execFileSync('git', ['add', '.dev-cycle/tracked.json'], { cwd: root, stdio: 'pipe' });
    const beforeTracked = repositorySnapshot(root);
    const trackedArtifact = runInit({ cwd: workspace, target: 'target', configPath: 'input.json', dryRun: true });
    assert.equal(trackedArtifact.status, 'failed');
    assert.equal(trackedArtifact.exitCode, 2);
    assert.match(trackedArtifact.errors.join('\n'), /artifact|tracked|추적|산출물/u);
    assert.deepEqual(repositorySnapshot(root), beforeTracked);
  } finally {
    removeWorkspace(workspace);
  }
});

test('템플릿 source 디렉터리의 링크를 따라가지 않고 설치 전에 거부한다', () => {
  const workspace = temporaryWorkspace('linked template source');
  try {
    const root = join(workspace, 'target');
    const templates = join(workspace, 'templates');
    const outside = join(workspace, 'outside agents');
    initializeGit(root);
    writeJson(join(workspace, 'input.json'), example);
    cpSync(resolve('templates'), templates, { recursive: true });
    cpSync(join(templates, 'workflow', '.claude', 'agents'), outside, { recursive: true });
    rmSync(join(templates, 'workflow', '.claude', 'agents'), { recursive: true });
    symlinkSync(outside, join(templates, 'workflow', '.claude', 'agents'), process.platform === 'win32' ? 'junction' : 'dir');
    const before = repositorySnapshot(root);

    const result = runInit({ cwd: workspace, target: 'target', configPath: 'input.json', templateDirectory: templates });
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 2);
    assert.match(result.errors.join('\n'), /link|symbolic|junction|링크/u);
    assert.deepEqual(repositorySnapshot(root), before);
  } finally {
    removeWorkspace(workspace);
  }
});

test('쓰기 실패는 불완전한 파일과 미생성 파일을 구분해 보고하고 기존 파일을 지우지 않는다', () => {
  const workspace = temporaryWorkspace('write failure');
  try {
    const root = join(workspace, 'target');
    initializeGit(root);
    writeJson(join(workspace, 'input.json'), example);
    writeFileSync(join(root, 'existing.txt'), '보존할 파일\n');
    const gitBefore = repositorySnapshot(join(root, '.git'));
    const originalWrite = fsDefault.writeSync;
    let writeCalls = 0;
    const injectedWrite = ((descriptor: number, data: Uint8Array, offset: number, length: number): number => {
      writeCalls += 1;
      if (writeCalls === 1) return originalWrite(descriptor, data, offset, length);
      if (writeCalls === 2) return originalWrite(descriptor, data, offset, Math.min(16, length));
      throw Object.assign(new Error('simulated disk full'), { code: 'ENOSPC' });
    }) as typeof fsDefault.writeSync;
    fsDefault.writeSync = injectedWrite;
    syncBuiltinESMExports();
    let result;
    try {
      result = runInit({ cwd: workspace, target: 'target', configPath: 'input.json' });
    } finally {
      fsDefault.writeSync = originalWrite;
      syncBuiltinESMExports();
    }
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 2);
    assert.match(result.errors.join('\n'), /simulated disk full/u);
    const created = result.files[0]!;
    assert.equal(created.path, manifest.files[0]?.target);
    assert.equal(created.status, 'created');
    assert.equal(created.partial, undefined);
    assert.equal(
      readFileSync(join(root, created.path), 'utf8'),
      readFileSync(join('templates', 'workflow', manifest.files[0]!.source), 'utf8'),
    );
    const failed = result.files[1]!;
    assert.equal(failed.path, manifest.files[1]?.target);
    assert.equal(failed.status, 'error');
    assert.equal(failed?.partial, true);
    const partial = readFileSync(join(root, failed.path), 'utf8');
    const expectedConfig = `${JSON.stringify(result.config, null, 2)}\n`;
    assert.equal(Buffer.byteLength(partial), 16);
    assert.equal(partial, expectedConfig.slice(0, partial.length));
    assert.equal(result.files.slice(2).every((file) => file.status === 'not-created'), true);
    for (const file of manifest.files.slice(2)) {
      assert.equal(lstatSync(join(root, file.target), { throwIfNoEntry: false }), undefined, file.target);
    }
    assert.equal(readFileSync(join(root, 'existing.txt'), 'utf8'), '보존할 파일\n');
    assert.deepEqual(repositorySnapshot(join(root, '.git')), gitBefore);
  } finally {
    removeWorkspace(workspace);
  }
});
