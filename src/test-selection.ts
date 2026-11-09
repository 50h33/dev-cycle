import type { WorkflowConfig } from './workflow.js';

export interface ChangedPath {
  path: string;
  status: string;
  previousPath?: string;
}

export interface TestSelection {
  mode: 'modules' | 'all' | 'skip';
  modules: string[];
  paths: ChangedPath[];
  reasons: string[];
  tasks: string[];
}

function settingsError(message: string): never {
  throw new Error(`settings.gradle: ${message}`);
}

function withoutComments(source: string): string {
  let result = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]!;
    const next = source[index + 1];
    if (quote) {
      result += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "'" || current === '"') {
      quote = current;
      result += current;
    } else if (current === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      result += '\n';
    } else if (current === '/' && next === '*') {
      result += ' ';
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') result += '\n';
        index += 1;
      }
      if (index >= source.length) settingsError('닫히지 않은 블록 주석입니다.');
      index += 1;
    } else {
      result += current;
    }
  }
  if (quote) settingsError('닫히지 않은 문자열입니다.');
  return result;
}

function validateModules(modules: readonly string[], origin: string): string[] {
  const seen = new Map<string, string>();
  return modules.map((module) => {
    if (module.toLowerCase() === 'build' || !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(module)
      || /[. ]$/u.test(module)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(module)) {
      throw new Error(`${origin}: 안전한 최상위 Gradle 모듈 이름이 아닙니다: ${module}`);
    }
    const key = module.toLowerCase();
    const previous = seen.get(key);
    if (previous) {
      const kind = previous === module ? '중복' : '대소문자 충돌';
      throw new Error(`${origin}: 모듈 이름 ${kind}: ${previous}, ${module}`);
    }
    seen.set(key, module);
    return module;
  });
}

function stringList(source: string): string[] {
  const modules: string[] = [];
  let position = 0;
  while (position < source.length) {
    while (/\s/u.test(source[position] ?? '')) position += 1;
    const quote = source[position];
    if (quote !== "'" && quote !== '"') settingsError('include에는 정적 문자열 리터럴만 사용할 수 있습니다.');
    const end = source.indexOf(quote, position + 1);
    if (end < 0) settingsError('include 문자열이 닫히지 않았습니다.');
    const value = source.slice(position + 1, end);
    if (value.includes('\\')) settingsError('include 모듈 이름의 escape 문법은 지원하지 않습니다.');
    modules.push(value);
    position = end + 1;
    while (/\s/u.test(source[position] ?? '')) position += 1;
    if (position === source.length) break;
    if (source[position] !== ',') settingsError('include 문자열 사이는 쉼표로 구분하세요.');
    position += 1;
    if (source.slice(position).trim() === '') settingsError('include 끝에 빈 항목이 있습니다.');
  }
  if (modules.length === 0) settingsError('include에 모듈 문자열을 하나 이상 지정하세요.');
  return modules;
}

/** Parses the supported static, top-level Groovy settings.gradle subset without evaluating it. */
export function parseGradleSettings(source: string): string[] {
  const input = withoutComments(source.replace(/^\uFEFF/u, ''));
  const endStatement = (position: number): number => {
    if (!/^[ \t]*(?:[;\r\n]|$)/u.test(input.slice(position))) settingsError('독립 문장은 줄바꿈이나 세미콜론으로 구분하세요.');
    return position;
  };
  const modules: string[] = [];
  let position = 0;
  let named = false;
  while (position < input.length) {
    const leading = /^(?:\s|;)+/u.exec(input.slice(position));
    if (leading) position += leading[0].length;
    if (position >= input.length) break;
    const remainder = input.slice(position);
    const root = /^rootProject\s*\.\s*name\s*=\s*(['"])([^'"\\\r\n]*)\1/u.exec(remainder);
    if (root) {
      if (named) settingsError('rootProject.name은 한 번만 지정하세요.');
      if (root[1] === '"' && root[2]!.includes('$')) settingsError('rootProject.name의 동적 문자열은 지원하지 않습니다.');
      named = true;
      position = endStatement(position + root[0].length);
      continue;
    }
    const parenthesized = /^include\s*\(([^)]*)\)/u.exec(remainder);
    if (parenthesized) {
      modules.push(...stringList(parenthesized[1]!));
      position = endStatement(position + parenthesized[0].length);
      continue;
    }
    const plain = /^include[ \t]+([^;\r\n]+)/u.exec(remainder);
    if (plain) {
      modules.push(...stringList(plain[1]!));
      position += plain[0].length;
      continue;
    }
    settingsError(`지원하지 않는 동적 또는 중첩 문법입니다: ${remainder.split(/\r?\n/u, 1)[0]!.trim()}`);
  }
  return validateModules(modules, 'settings.gradle');
}

function matches(path: string, pattern: string): boolean {
  const prefix = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  return path === prefix || (pattern.endsWith('/') && path.startsWith(`${prefix}/`));
}

function normalizedChangePath(path: string): string {
  if (!path || path.startsWith('/') || path.startsWith('-') || path.includes('\\')
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Git 변경 경로가 안전한 저장소 상대경로가 아닙니다: ${path}`);
  }
  return path;
}

/** Selects conservative Gradle test tasks from already collected Git changes. */
export function selectTests(
  changes: ChangedPath[],
  currentModules: string[],
  baseModules: string[],
  config: WorkflowConfig,
): TestSelection {
  const current = validateModules(currentModules, '현재 settings.gradle');
  const base = validateModules(baseModules, '기준 settings.gradle');
  const commonModules = validateModules(config.test.commonModules, 'dev-cycle.config.json commonModules');
  const currentKeys = new Set(current);
  for (const module of commonModules) {
    if (!currentKeys.has(module)) {
      throw new Error(`dev-cycle.config.json commonModules: 현재 settings.gradle에 없는 모듈입니다: ${module}`);
    }
  }
  const result = (mode: TestSelection['mode'], modules: string[], reasons: string[]): TestSelection => ({
    mode, modules, paths: changes, reasons,
    tasks: mode === 'all' ? ['test'] : mode === 'modules' ? modules.map((module) => `:${module}:test`) : [],
  });
  if (current.length !== base.length || current.some((module, index) => module !== base[index])) {
    return result('all', current, ['기준 버전과 현재 버전의 모듈 구성이 달라 현재 유효한 전체 테스트를 선택했습니다.']);
  }
  if (changes.length === 0) return result('skip', [], ['변경된 경로가 없어 테스트를 실행하지 않습니다.']);

  const moduleByName = new Map(current.map((module) => [module, module]));
  const selected = new Set<string>();
  const documentPaths: string[] = [];
  const unknownPaths: string[] = [];
  const allReasons: string[] = [];
  const defaults = ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts', 'gradle.properties', 'gradlew', 'gradlew.bat', 'gradle/', 'buildSrc/', 'build-logic/'];
  for (const change of changes) {
    const paths = [change.path, ...(change.previousPath === undefined ? [] : [change.previousPath])];
    for (const rawPath of paths) {
      const path = normalizedChangePath(rawPath);
      if ([...defaults, ...config.test.fullTestPaths].some((pattern) => matches(path, pattern))) {
        allReasons.push(`${path}: 빌드 또는 전체 영향 경로가 변경되었습니다.`);
        continue;
      }
      const first = path.split('/', 1)[0]!;
      const module = moduleByName.get(first);
      if (module && commonModules.includes(module)) {
        allReasons.push(`${path}: 공통 모듈 ${module} 변경은 전체 모듈에 영향을 줍니다.`);
      } else if (module) {
        selected.add(module);
      } else if (config.test.documentationPaths.some((pattern) => matches(path, pattern))) {
        documentPaths.push(path);
      } else {
        unknownPaths.push(path);
      }
    }
  }
  if (allReasons.length > 0) return result('all', current, [...new Set(allReasons)]);
  if (unknownPaths.length > 0) {
    return result('all', current, [`분류할 수 없는 경로를 제외하지 않고 전체 테스트로 확대했습니다: ${[...new Set(unknownPaths)].join(', ')}`]);
  }
  if (selected.size > 0) {
    const modules = current.filter((module) => selected.has(module));
    return result('modules', modules, [`변경된 모듈의 테스트를 선택했습니다: ${modules.join(', ')}`]);
  }
  if (documentPaths.length > 0) {
    return result('skip', [], [`명시된 문서 경로만 변경되어 테스트를 생략합니다: ${[...new Set(documentPaths)].join(', ')}`]);
  }
  return result('all', current, ['변경 경로의 영향을 확정할 수 없어 전체 테스트로 확대했습니다.']);
}
