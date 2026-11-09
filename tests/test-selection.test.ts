import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseGradleSettings, selectTests } from '../src/test-selection.js';
import { parseWorkflowConfig } from '../src/workflow.js';

const config = parseWorkflowConfig(JSON.parse(readFileSync('examples/dev-cycle.config.json', 'utf8')) as unknown);
config.test.commonModules = ['common'];
const modules = ['api', 'common', 'worker'];

test('정적 최상위 include와 주석, rootProject.name을 실행 없이 파싱한다', () => {
  const source = `
    // include 'ignored'
    rootProject.name = 'sample'
    include 'api', "common"
    include(
      'worker'
    )
    /* include 'also-ignored' */
  `;
  assert.deepEqual(parseGradleSettings(source), modules);
});

test('동적 또는 지원 밖 settings 문법과 안전하지 않은 모듈 이름을 거부한다', () => {
  const cases: [string, RegExp][] = [
    ["include modules", /정적 문자열/],
    ["include ':nested'", /안전한 최상위/],
    ["include 'api', 'API'", /대소문자 충돌/],
    ["include 'api', 'api'", /중복/],
    ["include 'build'", /안전한 최상위/],
    ["includeBuild '../other'", /includeBuild/],
    ["project(':api').projectDir = file('service')", /projectDir/],
    ["plugins { id 'java' }\ninclude 'api'", /지원하지 않는/],
    ["include('api')\ninclude('worker'", /지원하지 않는|닫히지/],
    ["/* open", /블록 주석/],
    ['rootProject.name = "${name}"\ninclude "api"', /동적 문자열/],
  ];
  for (const [source, error] of cases) assert.throws(() => parseGradleSettings(source), error);
});

test('모듈 변경과 rename의 이전·새 경로를 모두 반영해 태스크를 선택한다', () => {
  const selection = selectTests([
    { status: 'M', path: 'api/src/A.java' },
    { status: 'R', previousPath: 'worker/src/Old.java', path: 'api/src/New.java' },
  ], modules, modules, config);
  assert.equal(selection.mode, 'modules');
  assert.deepEqual(selection.modules, ['api', 'worker']);
  assert.deepEqual(selection.tasks, [':api:test', ':worker:test']);
});

test('공통 모듈, 빌드 설정, 모듈 구성 변경과 미분류 경로는 전체로 확대한다', () => {
  for (const [changes, current = modules, base = modules] of [
    [[{ status: 'M', path: 'common/src/Common.java' }]],
    [[{ status: 'M', path: 'gradle/wrapper/gradle-wrapper.properties' }]],
    [[{ status: 'A', path: 'scripts/release.sh' }]],
    [[{ status: 'A', path: 'API/src/Other.java' }]],
    [[{ status: 'M', path: 'api/src/A.java' }], ['api', 'common', 'new'], modules],
  ] as [Parameters<typeof selectTests>[0], string[]?, string[]?][]) {
    const selection = selectTests(changes, current, base, config);
    assert.equal(selection.mode, 'all');
    assert.deepEqual(selection.tasks, ['test']);
  }
});

test('문서만 변경과 빈 변경을 서로 다른 이유로 생략하고 전달된 산출물 경로는 숨기지 않는다', () => {
  const docs = selectTests([{ status: 'M', path: 'docs/guide.md' }], modules, modules, config);
  const empty = selectTests([], modules, modules, config);
  const own = selectTests([{ status: '?', path: '.dev-cycle/runs/1.json' }], modules, modules, config);
  assert.equal(docs.mode, 'skip');
  assert.match(docs.reasons[0]!, /문서/);
  assert.match(empty.reasons[0]!, /변경된 경로가 없어/);
  assert.equal(own.mode, 'all');
  assert.match(own.reasons[0]!, /분류할 수 없는/);
});

test('문서와 모듈 변경이 섞이면 모듈 테스트를 실행하고 rename된 미분류 경로는 전체로 확대한다', () => {
  assert.equal(selectTests([
    { status: 'M', path: 'README.md' },
    { status: 'M', path: 'api/src/A.java' },
  ], modules, modules, config).mode, 'modules');
  assert.equal(selectTests([
    { status: 'R', previousPath: 'legacy/source.java', path: 'api/src/New.java' },
  ], modules, modules, config).mode, 'all');
});

test('안전하지 않은 Git 경로와 모듈 목록을 입력 단계에서 거부한다', () => {
  assert.throws(() => selectTests([{ status: 'M', path: '../api/A.java' }], modules, modules, config), /상대경로/);
  assert.throws(() => selectTests([], ['api', 'API'], modules, config), /대소문자 충돌/);
  assert.throws(() => selectTests([], modules, modules, { ...config, test: { ...config.test, commonModules: ['Common'] } }), /없는 모듈/);
});

test('주석은 문자열 밖에서 토큰을 구분하고 문자열의 키워드를 동적 구문으로 오인하지 않는다', () => {
  assert.deepEqual(parseGradleSettings("include/* separator */'api'\n"), ['api']);
  assert.deepEqual(parseGradleSettings("rootProject.name = 'projectDir demo'\ninclude 'includeBuild', 'projectDir'\n"), ['includeBuild', 'projectDir']);
});

test('독립 settings 문장 사이에 구분자가 없으면 정적 분석을 중단한다', () => {
  assert.throws(() => parseGradleSettings("include('api')include('worker')"), /문장/u);
  assert.throws(() => parseGradleSettings("rootProject.name = 'demo'include('api')"), /문장/u);
  assert.deepEqual(parseGradleSettings("include('api'); include('worker')"), ['api', 'worker']);
});
