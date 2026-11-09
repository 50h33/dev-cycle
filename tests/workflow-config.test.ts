import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseWorkflowConfig, renderWorkflowTemplate } from '../src/workflow.js';

const example: unknown = JSON.parse(readFileSync('examples/dev-cycle.config.json', 'utf8'));

test('프로젝트 값과 인자 배열을 보존하고 baseRef만 명시된 기본 브랜치로 보완한다', () => {
  const config = parseWorkflowConfig(example);
  const withoutBaseRef = { ...config, baseRef: undefined };
  assert.equal(parseWorkflowConfig(withoutBaseRef).baseRef, config.defaultBranch);
  assert.deepEqual(parseWorkflowConfig(config), config);
  assert.deepEqual(config.commands.test?.windows?.args, ['test', '--console=plain']);
});

test('렌더링은 JSON 데이터만 치환하고 인자를 shell 문장으로 만들지 않는다', () => {
  const config = parseWorkflowConfig(example);
  config.commands.test = {
    executable: 'C:/Program Files/Test Runner/run.exe',
    args: ['a b', '한글', '$()', '&', '"quoted"', '{{literal}}', ''],
  };
  const rendered = renderWorkflowTemplate('{{configJson}}\n', config);
  assert.deepEqual(JSON.parse(rendered), config);
  assert.equal(renderWorkflowTemplate('공유 문서\n', config), '공유 문서\n');
});

test('알 수 없는 토큰과 닫히지 않은 토큰은 위치를 알려주고 거부한다', () => {
  for (const content of ['{{repository}}', '{{configJson', '{{configJson}} {{missing}}']) {
    assert.throws(() => renderWorkflowTemplate(content, example), /template.*placeholder/);
  }
});

const invalidCases: [string, (config: Record<string, unknown>) => void, RegExp][] = [
  ['미지원 버전', (c) => { c.schemaVersion = 2; }, /schemaVersion/],
  ['알 수 없는 키', (c) => { c.defaultBrnach = 'trunk'; }, /defaultBrnach/],
  ['누락된 저장소', (c) => { delete c.repository; }, /repository/],
  ['잘못된 저장소', (c) => { c.repository = 'https://example.org/a/b'; }, /repository/],
  ['모호한 비교 ref', (c) => { c.baseRef = '-HEAD'; }, /baseRef/],
  ['잘못된 브랜치', (c) => { c.defaultBranch = 'bad..branch'; }, /defaultBranch/],
  ['기본 브랜치에 full ref', (c) => { c.defaultBranch = 'refs/heads/trunk'; }, /defaultBranch/],
  ['기본 브랜치에 HEAD', (c) => { c.defaultBranch = 'HEAD'; }, /defaultBranch/],
  ['경로 이탈', (c) => { c.paths = { conventions: '../AGENTS.md' }; }, /paths.conventions/],
  ['명령 문자열', (c) => { c.commands = { test: './gradlew test' }; }, /commands.test/],
  ['문자열 인자', (c) => { c.commands = { test: { executable: 'node', args: '--test' } }; }, /commands.test.args/],
  ['명령 오타', (c) => { c.commands = { test: { executable: 'node', args: [], shell: true } }; }, /commands.test.shell/],
  ['테스트 명령 누락', (c) => { c.commands = {}; }, /commands.test/],
  ['Windows 옵션 오타', (c) => { c.commands = { test: { executable: 'node', args: [], windows: { executable: 'node', args: [], shell: true } } }; }, /windows.shell/],
  ['설정 자체를 결과 경로로 지정', (c) => { c.artifactsDir = 'dev-cycle.config.json'; }, /artifactsDir/],
  ['문서 경로를 결과 경로로 지정', (c) => { c.artifactsDir = 'docs'; }, /artifactsDir/],
  ['개인 설정 경로를 결과 경로로 지정', (c) => { c.artifactsDir = '.claude'; }, /artifactsDir/],
  ['glob 문서 경로', (c) => { c.test = { commonModules: [], fullTestPaths: [], documentationPaths: ['**/*.md'] }; }, /documentationPaths/],
  ['모듈 경로 이탈', (c) => { c.test = { commonModules: ['../shared'], fullTestPaths: [], documentationPaths: [] }; }, /commonModules/],
];

for (const [name, mutate, message] of invalidCases) {
  test(`잘못된 설정을 항목 경로와 함께 거부한다: ${name}`, () => {
    const config = structuredClone(example) as Record<string, unknown>;
    mutate(config);
    assert.throws(() => parseWorkflowConfig(config), message);
  });
}

test('Windows에서도 사용할 수 없는 상대경로를 거부한다', () => {
  for (const path of ['C:/data', '/data', 'docs\\guide.md', 'docs//a', './a', '.git/config', 'docs/NUL.md', 'docs/a.']) {
    const config = parseWorkflowConfig(example);
    config.paths.conventions = path;
    assert.throws(() => parseWorkflowConfig(config), /paths.conventions/);
  }
});

test('누락된 설정과 배열을 설정 객체로 받지 않는다', () => {
  for (const input of [null, undefined, [], true, 'config']) {
    assert.throws(() => parseWorkflowConfig(input), /dev-cycle.config.json/);
  }
});

test('점으로 끝나는 저장소 식별자를 거부하고 비교 ref에는 full ref를 허용한다', () => {
  const config = parseWorkflowConfig(example);
  for (const repository of ['owner/.', 'owner/..', 'owner/repo.']) {
    assert.throws(() => parseWorkflowConfig({ ...config, repository }), /repository/);
  }
  assert.equal(parseWorkflowConfig({ ...config, baseRef: 'refs/heads/trunk' }).baseRef, 'refs/heads/trunk');
  assert.equal(parseWorkflowConfig({ ...config, baseRef: 'HEAD' }).baseRef, 'HEAD');
});

test('사용자 문서 경로를 바꿔도 배포 파일과 겹치는 결과 디렉터리를 거부한다', () => {
  const config = parseWorkflowConfig(example);
  config.paths.conventions = 'guide/team.md';
  config.test.documentationPaths = [];
  for (const artifactsDir of ['.gitignore', '.GITIGNORE/cache', 'docs', 'docs/dev-cycle-workflow.md']) {
    assert.throws(() => parseWorkflowConfig({ ...config, artifactsDir }), /artifactsDir/);
  }
  assert.equal(parseWorkflowConfig({ ...config, artifactsDir: 'docs/results' }).artifactsDir, 'docs/results');
});
