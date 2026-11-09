import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { parseWorkflowConfig, renderWorkflowTemplate } from '../src/workflow.js';

const manifest = JSON.parse(readFileSync('templates/manifest.json', 'utf8')) as {
  schemaVersion: number; templateVersion: string; root: string;
  files: { source: string; target: string }[];
};
const templateRoot = resolve('templates', manifest.root);
const example: unknown = JSON.parse(readFileSync('examples/dev-cycle.config.json', 'utf8'));

function filesAt(root: string, path = root): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const file = join(path, entry.name);
    assert.equal(entry.isSymbolicLink(), false, file);
    return entry.isDirectory() ? filesAt(root, file) : [relative(root, file).split(sep).join('/')];
  });
}

test('manifest는 배포 파일 전부를 명시하고 개인 데이터나 외부 스킬을 포함하지 않는다', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.root, 'workflow');
  assert.match(manifest.templateVersion, /^\d+\.\d+\.\d+$/u);
  assert.deepEqual(manifest.files.map((entry) => entry.source).sort(), filesAt(templateRoot).sort());
  assert.equal(new Set(manifest.files.map((entry) => entry.target.toLowerCase())).size, manifest.files.length);
  const allowed = /^(?:CLAUDE\.md|dev-cycle\.config\.json|\.gitignore|docs\/dev-cycle-workflow\.md|\.claude\/(?:settings\.json|(?:claude-progress\.txt|feature_list\.json)\.example|agents\/(?:researcher|planner|reviewer|gardener)\.md|commands\/(?:dev-cycle|test|review-pr|resume|wrap-up)\.md|skills\/(?:issue|pr|apply-review)\/SKILL\.md))$/u;
  for (const entry of manifest.files) {
    assert.match(entry.target, allowed);
    assert.equal(resolve(templateRoot, entry.source).startsWith(templateRoot + sep), true);
  }
});

test('다른 프로젝트 두 곳에서 공백 경로를 포함해 설정과 배포물을 재현한다', () => {
  const first = parseWorkflowConfig(example);
  const second = parseWorkflowConfig({
    ...first, repository: 'another-team/inventory', defaultBranch: 'release/next', baseRef: 'refs/heads/release/next',
    paths: { conventions: 'project docs/team rules.md', issueTemplates: '.github/forms', prTemplate: '.github/review.md' },
    commands: { test: { executable: 'C:/Program Files/Runner/run.exe', args: ['test suite', '한글'] } },
    test: { commonModules: ['shared'], fullTestPaths: ['build scripts/'], documentationPaths: ['project docs/'] },
    artifactsDir: '.workflow output',
  });
  const temp = mkdtempSync(join(tmpdir(), 'dev-cycle workflow 한글 '));
  try {
    for (const [index, config] of [first, second].entries()) {
      const target = join(temp, `project ${index}`);
      mkdirSync(target);
      const initialized = spawnSync('git', ['init', '--quiet'], { cwd: target, encoding: 'utf8' });
      assert.equal(initialized.status, 0, initialized.stderr);
      for (const entry of manifest.files) {
        const output = join(target, entry.target);
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, renderWorkflowTemplate(readFileSync(join(templateRoot, entry.source), 'utf8'), config));
      }
      assert.deepEqual(JSON.parse(readFileSync(join(target, 'dev-cycle.config.json'), 'utf8')), config);
      const ignored = spawnSync('git', ['check-ignore', '--stdin'], {
        cwd: target, input: `${config.artifactsDir}/run.json\n.claude/settings.local.json\n.claude/claude-progress.txt\n.claude/feature_list.json\n.claude/logs/tools.jsonl\n`, encoding: 'utf8',
      });
      assert.equal(ignored.status, 0, ignored.stderr);
      assert.equal(ignored.stdout.trim().split(/\r?\n/u).length, 5);
      const shared = spawnSync('git', ['check-ignore', '--stdin'], {
        cwd: target, input: manifest.files.map((file) => file.target).join('\n') + '\n', encoding: 'utf8',
      });
      assert.equal(shared.status, 1, shared.stdout);
      for (const entry of manifest.files.filter((file) => file.target.endsWith('.md'))) {
        const content = readFileSync(join(target, entry.target), 'utf8');
        if (!entry.target.startsWith('docs/')) {
          assert.doesNotMatch(content, /TicketRush|develop\.\.\.|backend-convention|seat-service|SLACK_WRAP_WEBHOOK|Invoke-RestMethod/u);
        }
        assert.doesNotMatch(content, /\{\{[^}]+\}\}/u);
        for (const match of content.matchAll(/\]\(([^)]+)\)/gu)) {
          const href = match[1]!;
          if (/^https?:/u.test(href) || href.startsWith('#')) continue;
          const destination = resolve(dirname(join(target, entry.target)), href.split('#')[0]!);
          assert.equal(destination.startsWith(target + sep), true, href);
          assert.doesNotThrow(() => readFileSync(destination), href);
        }
      }
    }
  } finally {
    assert.equal(temp.startsWith(join(tmpdir(), 'dev-cycle workflow 한글 ')), true);
    rmSync(temp, { recursive: true, force: true });
  }
});

test('공유 권한은 plan 기본값만 가지며 메모는 실제 이슈 상태를 담지 않는다', () => {
  assert.deepEqual(JSON.parse(readFileSync(join(templateRoot, '.claude/settings.json'), 'utf8')), { permissions: { defaultMode: 'plan' } });
  const notes = JSON.parse(readFileSync(join(templateRoot, '.claude/feature_list.json.example'), 'utf8')) as {
    items: { issue: unknown; status: string }[];
  };
  assert.equal(notes.items.every((item) => item.issue === null && item.status === 'todo'), true);
});

test('Claude Code 역할과 스킬 메타데이터가 있고 명령 이름이 서로 충돌하지 않는다', () => {
  const names = new Set<string>();
  for (const entry of manifest.files.filter((file) => /^\.claude\/(agents|commands|skills)\//u.test(file.target))) {
    const content = readFileSync(join(templateRoot, entry.source), 'utf8');
    const frontmatter = /^---\r?\n([\s\S]+?)\r?\n---\r?\n/u.exec(content)?.[1];
    assert.ok(frontmatter, entry.target);
    assert.match(frontmatter, /^description: .+$/mu, entry.target);
    const isCommand = entry.target.startsWith('.claude/commands/');
    const fileName = isCommand ? entry.target.split('/').at(-1)!.replace(/\.md$/u, '')
      : /^name: (.+)$/mu.exec(frontmatter)?.[1];
    assert.ok(fileName, entry.target);
    if (entry.target.startsWith('.claude/agents/')) {
      assert.match(frontmatter, /^tools: Read, Grep, Glob, Bash(?:, WebSearch, WebFetch)?$/mu);
    } else {
      assert.equal(names.has(fileName), false, `command/skill name collision: ${fileName}`);
      names.add(fileName);
    }
  }
});
