import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { runInit } from '../src/init.js';
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

function treeDigest(directory: string): string {
  const hash = createHash('sha256');
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    hash.update(entry.name).update('\0').update(entry.isDirectory() ? treeDigest(path) : fs.readFileSync(path));
  }
  return hash.digest('hex');
}

function projectConfig(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    repository: 'example/end-to-end',
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
const task = process.argv.slice(2).find((arg) => /^:[A-Za-z0-9_.-]+:test$/.test(arg) || arg === 'test') ?? 'test';
const moduleName = /^:([^:]+):test$/.exec(task)?.[1] ?? '';
const directory = path.join(moduleName, 'build', 'test-results', 'test');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'TEST-flow.xml'), '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>');
console.log('> Task ' + task);
`;

test('빈 저장소에서 init dry-run, 설치, 재실행, test dry-run, 실제 실행과 report 생성을 연결한다', async () => {
  const parent = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'dev-cycle full flow 한글 ')));
  temporary.push(parent);
  const root = join(parent, 'target repository');
  const configPath = join(parent, 'workflow config.json');
  fs.mkdirSync(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Flow Test']);
  git(root, ['config', 'user.email', 'flow@example.test']);
  write(configPath, `${JSON.stringify(projectConfig(), null, 2)}\n`);

  const beforeInit = treeDigest(root);
  const preview = runInit({ target: root, configPath, dryRun: true });
  assert.equal(treeDigest(root), beforeInit);
  assert.equal(preview.status, 'ready');
  assert.equal(preview.files.every((file) => file.status === 'create'), true);
  assert.equal(fs.existsSync(join(root, 'CLAUDE.md')), false);

  const installed = runInit({ target: root, configPath });
  assert.equal(installed.status, 'completed');
  assert.equal(installed.files.every((file) => file.status === 'created'), true);
  const repeated = runInit({ target: root, configPath });
  assert.equal(repeated.status, 'completed');
  assert.equal(repeated.files.every((file) => file.status === 'unchanged'), true);

  write(join(root, 'settings.gradle'), "rootProject.name = 'flow'\ninclude 'app'\n");
  write(join(root, 'app/src/Main.java'), 'class Main {}\n');
  write(join(root, 'gradlew'), runner);
  fs.chmodSync(join(root, 'gradlew'), 0o755);
  write(join(root, 'gradlew.bat'), '@echo off\nnode "%~dp0gradlew" %*\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'installed workflow']);
  fs.appendFileSync(join(root, 'app/src/Main.java'), '// changed\n');

  const beforeTest = treeDigest(root);
  const testPreview = await runTest({ target: root, dryRun: true });
  assert.equal(treeDigest(root), beforeTest);
  assert.equal(testPreview.status, 'not-run');
  assert.deepEqual(testPreview.selection?.tasks, [':app:test']);
  assert.equal(fs.existsSync(join(root, '.dev-cycle')), false);

  const executed = await runTest({ target: root });
  assert.equal(executed.status, 'succeeded');
  assert.deepEqual(executed.evidence?.counts, { tests: 1, failures: 0, errors: 0, skipped: 0 });
  assert.ok(executed.runId);

  const beforeReport = treeDigest(root);
  const reportPreview = runReport({
    target: root,
    runId: executed.runId!,
    outputPath: '.dev-cycle/reports/pull-request.md',
    dryRun: true,
  });
  assert.equal(treeDigest(root), beforeReport);
  assert.equal(reportPreview.status, 'generated');
  assert.equal(reportPreview.freshness?.status, 'current');
  assert.equal(fs.existsSync(join(root, '.dev-cycle', 'reports', 'pull-request.md')), false);

  const report = runReport({ target: root, runId: executed.runId!, outputPath: '.dev-cycle/reports/pull-request.md' });
  assert.equal(report.status, 'generated');
  assert.equal(report.outputPath, resolve(root, '.dev-cycle/reports/pull-request.md'));
  assert.match(report.markdown, /:app:test/u);
  assert.match(report.markdown, /tests[^\n]*1/u);
  assert.equal(fs.readFileSync(report.outputPath!, 'utf8'), report.markdown);

  const afterReport = runReport({ target: root, runId: executed.runId! });
  assert.equal(afterReport.freshness?.status, 'current');

  const cli = spawnSync(process.execPath, [resolve('.test-dist/src/cli.js'), 'report', root, '--run-id', executed.runId!, '--json'], {
    encoding: 'utf8', shell: false,
  });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  assert.equal(cli.stderr, '');
  const cliResult = JSON.parse(cli.stdout) as { command: string; status: string; run: { runId: string }; markdown: string };
  assert.equal(cliResult.command, 'report');
  assert.equal(cliResult.status, 'generated');
  assert.equal(cliResult.run.runId, executed.runId);
  assert.equal(cliResult.markdown, report.markdown);
  const human = spawnSync(process.execPath, [resolve('.test-dist/src/cli.js'), 'report', root,
    '--output=.dev-cycle/reports/human.md', '--dry-run'], { encoding: 'utf8', shell: false });
  assert.equal(human.status, 0, human.stderr || human.stdout);
  assert.match(human.stdout, /^## 검증 기록/u);
  assert.match(human.stdout, /dry-run/u);
  assert.equal(fs.existsSync(join(root, '.dev-cycle/reports/human.md')), false);
});

test('init 충돌은 기존 파일을 보존하고 test와 report로 진행한 것처럼 보이지 않는다', () => {
  const parent = fs.mkdtempSync(join(tmpdir(), 'dev-cycle conflict flow '));
  temporary.push(parent);
  const root = join(parent, 'target');
  const configPath = join(parent, 'config.json');
  fs.mkdirSync(root);
  git(root, ['init', '-b', 'main']);
  write(configPath, `${JSON.stringify(projectConfig(), null, 2)}\n`);
  write(join(root, 'CLAUDE.md'), '# user instructions\n');

  const result = runInit({ target: root, configPath });
  assert.equal(result.status, 'blocked');
  assert.equal(result.exitCode, 1);
  assert.equal(fs.readFileSync(join(root, 'CLAUDE.md'), 'utf8'), '# user instructions\n');
  assert.equal(fs.existsSync(join(root, '.claude')), false);
  assert.equal(fs.existsSync(join(root, '.dev-cycle')), false);
});
