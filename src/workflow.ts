/** Portable data contract for the extracted workflow. No filesystem or process effects. */
export interface CommandSpec {
  executable: string;
  args: string[];
  windows?: { executable: string; args: string[] };
}

export interface WorkflowConfig {
  schemaVersion: 1;
  repository: string;
  defaultBranch: string;
  baseRef: string;
  paths: { conventions: string; issueTemplates: string; prTemplate: string };
  commands: Record<string, CommandSpec>;
  test: { commonModules: string[]; fullTestPaths: string[]; documentationPaths: string[] };
  artifactsDir: string;
}

function invalid(path: string, message: string): never {
  throw new Error(`dev-cycle.config.json: ${path} - ${message}`);
}

function object(value: unknown, path: string, keys?: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, '객체를 지정하세요.');
  }
  if (keys) {
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) invalid(`${path}.${key}`, '지원하지 않는 설정 키입니다.');
    }
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() !== value || !value || /\p{Cc}/u.test(value)) {
    invalid(path, '앞뒤 공백이나 제어 문자가 없는 문자열을 지정하세요.');
  }
  return value;
}

function list(value: unknown, path: string, parse: (item: unknown, path: string) => string): string[] {
  if (!Array.isArray(value)) invalid(path, '문자열 배열을 지정하세요.');
  return value.map((item: unknown, i) => parse(item, `${path}[${i}]`));
}

function relativePath(value: unknown, path: string, directoryPrefix = false): string {
  const result = text(value, path);
  const normalized = directoryPrefix ? result.replace(/\/$/u, '') : result;
  const segments = normalized.split('/');
  if (/[\\:*?"<>|]/u.test(result) || result.includes('[') || result.includes(']') || segments.some((segment) =>
    !segment || segment === '.' || segment === '..' || /[. ]$/u.test(segment)
    || segment.toLowerCase() === '.git' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) {
    invalid(path, '저장소 루트 기준 상대경로를 /로 구분하세요. 경로 이탈, glob과 Windows 예약 이름은 사용할 수 없습니다.');
  }
  return result;
}

function ref(value: unknown, path: string): string {
  const result = text(value, path);
  if (result.startsWith('-') || result === '@' || /[\s~^:?*[\\]/u.test(result)
    || result.includes('..') || result.includes('@{') || result.endsWith('.')
    || result.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    invalid(path, '옵션이나 revision 식이 아닌 브랜치/ref 이름을 지정하세요.');
  }
  return result;
}

function command(value: unknown, path: string, allowWindows = true): CommandSpec {
  const raw = object(value, path, allowWindows ? ['executable', 'args', 'windows'] : ['executable', 'args']);
  const result: CommandSpec = {
    executable: text(raw.executable, `${path}.executable`),
    args: list(raw.args, `${path}.args`, (arg, at) => {
      if (typeof arg !== 'string' || arg.includes('\0')) invalid(at, 'NUL 없는 문자열 인자를 지정하세요.');
      return arg;
    }),
  };
  if (raw.windows !== undefined) result.windows = command(raw.windows, `${path}.windows`, false);
  return result;
}

/** Validates explicit configuration; only baseRef defaults to defaultBranch. No Git/network discovery. */
export function parseWorkflowConfig(input: unknown): WorkflowConfig {
  const raw = object(input, '$', ['schemaVersion', 'repository', 'defaultBranch', 'baseRef', 'paths', 'commands', 'test', 'artifactsDir']);
  if (raw.schemaVersion !== 1) invalid('schemaVersion', '지원하는 버전 1을 지정하세요.');
  const repository = text(raw.repository, 'repository');
  if (!/^[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/iu.test(repository) || repository.endsWith('.')) {
    invalid('repository', 'GitHub owner/repository 형식으로 지정하세요.');
  }
  const defaultBranch = ref(raw.defaultBranch, 'defaultBranch');
  if (defaultBranch === 'HEAD' || defaultBranch.startsWith('refs/')) {
    invalid('defaultBranch', 'HEAD나 refs/heads/ 접두사가 아닌 짧은 브랜치 이름을 지정하세요.');
  }
  const rawPaths = object(raw.paths, 'paths', ['conventions', 'issueTemplates', 'prTemplate']);
  const paths = {
    conventions: relativePath(rawPaths.conventions, 'paths.conventions'),
    issueTemplates: relativePath(rawPaths.issueTemplates, 'paths.issueTemplates'),
    prTemplate: relativePath(rawPaths.prTemplate, 'paths.prTemplate'),
  };
  const rawCommands = object(raw.commands, 'commands');
  if (!Object.hasOwn(rawCommands, 'test')) invalid('commands.test', '테스트 명령을 지정하세요.');
  const commands = Object.fromEntries(Object.entries(rawCommands).map(([name, value]) => {
    if (!/^[a-z][a-z\d-]*$/u.test(name)) invalid(`commands.${name}`, '명령 이름은 소문자, 숫자와 -로 지정하세요.');
    return [name, command(value, `commands.${name}`)];
  }));
  const rawTest = object(raw.test, 'test', ['commonModules', 'fullTestPaths', 'documentationPaths']);
  const test = {
    commonModules: list(rawTest.commonModules, 'test.commonModules', (item, path) => {
      const module = relativePath(item, path);
      if (module.includes('/')) invalid(path, '최상위 모듈 디렉터리 이름을 지정하세요.');
      return module;
    }),
    fullTestPaths: list(rawTest.fullTestPaths, 'test.fullTestPaths', (item, path) => relativePath(item, path, true)),
    documentationPaths: list(rawTest.documentationPaths, 'test.documentationPaths', (item, path) => relativePath(item, path, true)),
  };
  const artifactsDir = relativePath(raw.artifactsDir, 'artifactsDir');
  const reserved = ['.claude', '.gitignore', 'CLAUDE.md', 'dev-cycle.config.json', 'docs/dev-cycle-workflow.md', ...Object.values(paths),
    ...test.commonModules, ...test.fullTestPaths, ...test.documentationPaths];
  const artifact = artifactsDir.toLowerCase();
  for (const path of reserved) {
    const other = path.replace(/\/$/u, '').toLowerCase();
    if (artifact === other || artifact.startsWith(`${other}/`) || other.startsWith(`${artifact}/`)) {
      invalid('artifactsDir', `${path} 경로와 겹치지 않는 전용 디렉터리를 지정하세요.`);
    }
  }
  return {
    schemaVersion: 1, repository, defaultBranch,
    baseRef: raw.baseRef === undefined ? defaultBranch : ref(raw.baseRef, 'baseRef'),
    paths, commands, test, artifactsDir,
  };
}

/** Only config JSON and the gitignore output directory are substituted. No shell interpolation. */
export function renderWorkflowTemplate(template: string, input: unknown): string {
  const remainder = template.replaceAll('{{configJson}}', '').replaceAll('{{artifactsDir}}', '');
  if (remainder.includes('{{') || remainder.includes('}}')) {
    throw new Error('template: 알 수 없거나 닫히지 않은 placeholder입니다. {{configJson}}, {{artifactsDir}}만 사용할 수 있습니다.');
  }
  const config = parseWorkflowConfig(input);
  return template.replace(/\{\{(configJson|artifactsDir)\}\}/gu, (_token, key: string) =>
    key === 'configJson' ? JSON.stringify(config, null, 2) : config.artifactsDir);
}
