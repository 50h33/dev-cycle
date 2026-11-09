import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const cli = resolve('.test-dist/src/cli.js');

test('설치 대상 .gitignore는 npm 패키지에서 제외되지 않는 source 이름을 사용한다', () => {
  const manifest = JSON.parse(readFileSync('templates/manifest.json', 'utf8')) as {
    files: { source: string; target: string }[];
  };
  const entry = manifest.files.find((file) => file.target === '.gitignore');
  assert.ok(entry);
  assert.notEqual(entry.source, '.gitignore');
});

function invoke(args: string[], cwd = process.cwd()) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

function fixture(name: string): { parent: string; target: string; config: string } {
  const parent = mkdtempSync(join(tmpdir(), `dev-cycle cli ${name} 한글 `));
  const target = join(parent, 'target repository');
  const config = join(parent, 'project config.json');
  mkdirSync(target);
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: target, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  copyFileSync(resolve('examples/dev-cycle.config.json'), config);
  return { parent, target, config };
}

test('도움말, 버전과 JSON 도움말은 성공 종료하고 stdout 형식을 지킨다', () => {
  const help = invoke([]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /dev-cycle init/);

  const jsonHelp = invoke(['--help', '--json']);
  assert.equal(jsonHelp.status, 0, jsonHelp.stderr);
  assert.equal(jsonHelp.stderr, '');
  const helpResult = JSON.parse(jsonHelp.stdout) as { status: string; exitCode: number };
  assert.deepEqual({ status: helpResult.status, exitCode: helpResult.exitCode }, { status: 'help', exitCode: 0 });

  const version = invoke(['--version']);
  assert.equal(version.status, 0, version.stderr);
  const expected = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  assert.equal(version.stdout.trim(), expected);
});

test('알 수 없는 명령, 옵션과 중복 인자를 JSON 오류와 종료 코드 2로 보고한다', () => {
  const cases = [
    ['unknown'],
    ['init', '--force'],
    ['init', 'one', 'two'],
    ['init', '--dry-run', '--dry-run'],
    ['init', '--config', 'one.json', '--config=two.json'],
    ['init', '--json', '--json'],
    ['init', '--base-ref', 'main'],
    ['test', '--base-ref'],
    ['test', '--base-ref='],
    ['test', '--base-ref', 'main', '--base-ref', 'HEAD'],
  ];
  for (const args of cases) {
    const result = invoke([...args, ...(args.includes('--json') ? [] : ['--json'])]);
    assert.equal(result.status, 2, `${args.join(' ')}\n${result.stderr}`);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout) as { schemaVersion: number; status: string; errors: unknown[]; exitCode: number };
    assert.equal(output.schemaVersion, 1);
    assert.equal(output.status, 'failed');
    assert.equal(output.exitCode, 2);
    assert.equal(output.errors.length > 0, true);
  }

  const misplaced = invoke(['unknown', 'init', '--json']);
  assert.equal(misplaced.status, 2, misplaced.stderr);
  assert.equal((JSON.parse(misplaced.stdout) as { command: unknown }).command, null);
});

test('test CLI는 dry-run JSON 하나와 사람용 선택 이유를 출력하고 기록을 만들지 않는다', () => {
  const { parent, target, config } = fixture('test');
  try {
    const value = JSON.parse(readFileSync(config, 'utf8')) as { baseRef: string };
    value.baseRef = 'HEAD';
    writeFileSync(config, JSON.stringify(value));
    writeFileSync(join(target, 'settings.gradle'), "include 'app'\n");
    mkdirSync(join(target, 'app'));
    writeFileSync(join(target, 'app', 'source.txt'), 'original');
    const added = spawnSync('git', ['add', '.'], { cwd: target, encoding: 'utf8' });
    assert.equal(added.status, 0, added.stderr);
    const committed = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: target, encoding: 'utf8' });
    assert.equal(committed.status, 0, committed.stderr);
    writeFileSync(join(target, 'app', 'source.txt'), 'modified');
    const preview = invoke(['test', target, '--config', config, '--dry-run', '--json']);
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    assert.equal(preview.stderr, '');
    const output = JSON.parse(preview.stdout) as { command: string; status: string; analysis: string; selection: { tasks: string[] }; recordPath: unknown };
    assert.equal(output.command, 'test');
    assert.equal(output.status, 'not-run');
    assert.equal(output.analysis, 'complete');
    assert.deepEqual(output.selection.tasks, [':app:test']);
    assert.equal(output.recordPath, null);
    assert.equal(existsSync(join(target, '.dev-cycle')), false);
    const human = invoke(['test', target, '--config', config, '--base-ref=HEAD', '--dry-run']);
    assert.equal(human.status, 0, human.stderr || human.stdout);
    assert.match(human.stdout, /선택: modules/u);
    const missing = invoke(['test', target, '--config', config, '--base-ref=missing-ref', '--dry-run', '--json']);
    assert.equal(missing.status, 2);
    assert.equal((JSON.parse(missing.stdout) as { analysis: string }).analysis, 'error');
  } finally {
    assert.equal(parent.startsWith(join(tmpdir(), 'dev-cycle cli test 한글 ')), true);
    rmSync(parent, { recursive: true, force: true });
  }
});

test('공백과 한글 경로의 빈 Git 저장소를 dry-run한 뒤 설치하고 재실행한다', () => {
  const { parent, target, config } = fixture('install');
  try {
    const dryRun = invoke(['init', target, '--config', config, '--dry-run', '--json'], parent);
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    const preview = JSON.parse(dryRun.stdout) as {
      status: string; dryRun: boolean; root: string; files: { status: string }[]; exitCode: number;
    };
    assert.equal(preview.status, 'ready');
    assert.equal(preview.dryRun, true);
    assert.equal(preview.root, realpathSync.native(target));
    assert.equal(preview.files.every((file) => file.status === 'create'), true);
    assert.equal(preview.exitCode, 0);
    assert.equal(existsSync(join(target, 'CLAUDE.md')), false);
    assert.equal(existsSync(join(target, '.claude')), false);

    const installed = invoke(['init', target, `--config=${config}`, '--json'], parent);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    const first = JSON.parse(installed.stdout) as { status: string; files: { status: string }[]; exitCode: number };
    assert.equal(first.status, 'completed');
    assert.equal(first.files.every((file) => file.status === 'created'), true);
    assert.equal(first.exitCode, 0);
    assert.equal(existsSync(join(target, 'CLAUDE.md')), true);
    assert.equal(existsSync(join(target, '.claude', 'settings.json')), true);

    const repeated = invoke(['init', target, '--config', config, '--json'], parent);
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    const second = JSON.parse(repeated.stdout) as { status: string; files: { status: string }[]; exitCode: number };
    assert.equal(second.status, 'completed');
    assert.equal(second.files.every((file) => file.status === 'unchanged'), true);
    assert.equal(second.exitCode, 0);

    const emptyConfig = invoke(['init', target, '--config', '', '--json'], parent);
    assert.equal(emptyConfig.status, 2, '빈 --config 값을 기존 설정으로 대체해서는 안 됩니다.');
    assert.match((JSON.parse(emptyConfig.stdout) as { errors: string[] }).errors.join('\n'), /--config/u);

    const emptyTarget = invoke(['init', '', '--config', config, '--dry-run', '--json'], target);
    assert.equal(emptyTarget.status, 2, '명시한 빈 대상 경로를 현재 저장소로 대체해서는 안 됩니다.');
  } finally {
    assert.equal(parent.startsWith(join(tmpdir(), 'dev-cycle cli install 한글 ')), true);
    rmSync(parent, { recursive: true, force: true });
  }
});

test('기존 파일 충돌 시 종료 코드 1을 반환하고 어떤 신규 파일도 만들지 않는다', () => {
  const { parent, target, config } = fixture('conflict');
  try {
    const original = '# existing instructions\n';
    writeFileSync(join(target, 'CLAUDE.md'), original);
    const result = invoke(['init', target, '--config', config, '--json'], parent);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout) as {
      status: string; files: { path: string; status: string; message: string }[]; errors: string[]; exitCode: number;
    };
    assert.equal(output.status, 'blocked');
    assert.equal(output.exitCode, 1);
    const conflict = output.files.find((file) => file.path === 'CLAUDE.md' && file.status === 'conflict');
    assert.ok(conflict, result.stdout);
    assert.match(conflict.message, /보존.*수동.*재실행/u);
    assert.deepEqual(output.errors, []);
    assert.equal(readFileSync(join(target, 'CLAUDE.md'), 'utf8'), original);
    assert.equal(existsSync(join(target, '.claude')), false);
    assert.equal(existsSync(join(target, 'dev-cycle.config.json')), false);
  } finally {
    assert.equal(parent.startsWith(join(tmpdir(), 'dev-cycle cli conflict 한글 ')), true);
    rmSync(parent, { recursive: true, force: true });
  }
});
