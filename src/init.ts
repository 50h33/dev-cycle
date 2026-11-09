import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflowConfig, renderWorkflowTemplate } from './workflow.js';
import type { WorkflowConfig } from './workflow.js';

export interface InitOptions {
  cwd?: string;
  target?: string;
  configPath?: string;
  dryRun?: boolean;
  /** Local template package override, primarily for isolated validation. */
  templateDirectory?: string;
}

export interface InitFile {
  path: string;
  status: 'create' | 'unchanged' | 'conflict' | 'error' | 'created' | 'not-created';
  message: string;
  /** A newly opened file may contain incomplete data after an I/O failure. */
  partial?: boolean;
}

export interface InitResult {
  schemaVersion: 1;
  command: 'init';
  dryRun: boolean;
  root: string | null;
  status: 'ready' | 'completed' | 'blocked' | 'failed';
  templateVersion: string | null;
  config: WorkflowConfig | null;
  files: InitFile[];
  createdDirectories: string[];
  errors: string[];
  warnings: string[];
  /** 0: success or valid preview, 1: conflicts, 2: invalid input or I/O failure. */
  exitCode: 0 | 1 | 2;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function stat(path: string): fs.Stats | undefined {
  try { return fs.lstatSync(path); } catch (error) { if (!missing(error)) throw error; }
}

/** Portable paths only; a package manifest must not address Git internals or escape its root. */
function portablePath(input: unknown): string {
  if (typeof input !== 'string' || !input || /[\\:*?"<>|[\]\p{Cc}]/u.test(input)
    || input.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/u.test(part)
      || part.toLowerCase() === '.git' || /^(?:(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)|con(?:in|out)\$$)/iu.test(part))) {
    throw new Error(`안전한 / 구분 상대경로가 아닙니다: ${String(input)}`);
  }
  return input;
}

/** Inspect every existing component, including case variants, without following links. */
function inspect(root: string, path: string): fs.Stats | undefined {
  const parts = portablePath(path).split('/');
  let current = root;
  let found: fs.Stats | undefined;
  for (const [index, part] of parts.entries()) {
    const matches = fs.readdirSync(current).filter((name) => name.toLowerCase() === part.toLowerCase());
    if (matches.some((name) => name !== part)) throw new Error(`${path}: 대소문자 경로 충돌 (${matches.join(', ')}). 이름을 정리하세요.`);
    current = join(current, part);
    found = stat(current);
    if (!found) return undefined;
    if (found.isSymbolicLink()) throw new Error(`${path}: 심볼릭 링크/junction은 허용하지 않습니다.`);
    if (index < parts.length - 1 && !found.isDirectory()) throw new Error(`${path}: 상위 경로가 디렉터리가 아닙니다.`);
  }
  return found;
}

function directory(path: string): string {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    const found = fs.lstatSync(current);
    if (found.isSymbolicLink() || !found.isDirectory()) throw new Error(`${current}: 링크가 아닌 실제 디렉터리를 지정하세요.`);
  }
  // Canonicalize Windows 8.3 aliases before comparing filesystem paths with Git's root.
  return fs.realpathSync.native(absolute);
}

function git(root: string, args: string[], input?: string, allowedExitCodes: readonly number[] = [0]): string {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  // An inherited Git override must not redirect inspection to a different checkout/index.
  for (const key of Object.keys(env)) {
    if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|CONFIG.*)$/iu.test(key)) delete env[key];
    if (/^GIT_TRACE/iu.test(key)) delete env[key];
  }
  // Read-only Git commands can still write trace files; override global Trace2 targets as well.
  Object.assign(env, { GIT_TRACE: '0', GIT_TRACE2: '0', GIT_TRACE2_EVENT: '0', GIT_TRACE2_PERF: '0' });
  const result = spawnSync('git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8', shell: false, env, maxBuffer: 16 * 1024 * 1024, ...(input === undefined ? {} : { input }),
  });
  if (result.error || result.status === null || !allowedExitCodes.includes(result.status)) throw new Error(`Git 조회 실패: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout;
}

function templateDirectory(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (stat(join(current, 'package.json'))) return join(current, 'templates');
    const parent = dirname(current);
    if (parent === current) throw new Error('배포 패키지의 templates 디렉터리를 찾을 수 없습니다.');
    current = parent;
  }
}

function readJson(path: string): unknown {
  try { return JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/u, '')) as unknown; }
  catch (error) { throw new Error(`${path}: JSON을 읽을 수 없습니다. ${message(error)}`, { cause: error }); }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('manifest: 객체를 지정하세요.');
  return value as Record<string, unknown>;
}

function sameConfig(content: string, config: WorkflowConfig): boolean {
  try {
    // The parser fixes key order; command names remain an unordered mapping.
    const canonical = (input: unknown): string => {
      const parsed = parseWorkflowConfig(input);
      parsed.commands = Object.fromEntries(Object.entries(parsed.commands).sort(([a], [b]) => a.localeCompare(b)));
      return JSON.stringify(parsed);
    };
    return canonical(JSON.parse(content.replace(/^\uFEFF/u, ''))) === canonical(config);
  } catch { return false; }
}

function sameContent(path: string, actual: string, expected: string, config: WorkflowConfig): boolean {
  // All manifest assets are UTF-8 text. Keep Git's CRLF checkout bytes without rewriting them.
  if (actual.replaceAll('\r\n', '\n') === expected.replaceAll('\r\n', '\n')) return true;
  if (path === 'dev-cycle.config.json') return sameConfig(actual, config);
  if (path === '.gitignore') {
    const normalize = (text: string): string => text.replaceAll('\r\n', '\n').replace(/\n+$/u, '');
    const block = normalize(expected);
    const existing = normalize(actual);
    return existing === block || existing.endsWith(`\n${block}`);
  }
  return false;
}

function inspectFile(root: string, file: InitFile, content: string, config: WorkflowConfig): InitFile['status'] {
  const found = inspect(root, file.path);
  if (!found) { file.status = 'create'; file.message = '새 파일 생성 예정'; return file.status; }
  if (!found.isFile()) throw new Error(`${file.path}: 설치 대상이 일반 파일이 아닙니다.`);
  if (sameContent(file.path, fs.readFileSync(join(root, file.path), 'utf8'), content, config)) {
    file.status = 'unchanged'; file.message = '기존 내용을 보존합니다.';
  } else {
    file.status = 'conflict';
    file.message = file.path === '.gitignore'
      ? '기존 파일을 보존합니다. templates/workflow/gitignore.template의 산출물 경로를 설정값으로 바꾼 블록을 파일 마지막에 수동 추가한 뒤 재실행하세요.'
      : '기존 파일을 보존합니다. 배포 템플릿과 비교해 수동으로 처리한 뒤 재실행하세요. 자동 병합/강제 덮어쓰기는 지원하지 않습니다.';
  }
  return file.status;
}

function checkIgnored(root: string, config: WorkflowConfig, planned: boolean): void {
  if (planned) {
    const excludedNodes = [config.artifactsDir, '.claude/settings.local.json', '.claude/claude-progress.txt', '.claude/feature_list.json', '.claude/logs'];
    const ancestors = new Set<string>();
    for (const node of excludedNodes) {
      const parts = node.split('/');
      while (parts.length > 1) {
        parts.pop();
        ancestors.add(`${parts.join('/')}/.gitignore`);
      }
    }
    // Git cannot preview directory negations for paths that do not exist yet. Fail closed only
    // on ancestor negations; rules inside an excluded directory cannot re-include its children.
    for (const path of ancestors) {
      const found = inspect(root, path);
      if (!found) continue;
      if (!found.isFile()) throw new Error(`${path}: Git 제외 규칙은 일반 파일이어야 합니다.`);
      const content = fs.readFileSync(join(root, path), 'utf8').replace(/^\uFEFF/u, '');
      if (content.split('\n').some((line) => line.startsWith('!'))) {
        throw new Error(`${path}: 예외 규칙(!)을 먼저 수동으로 검토하세요. 새 .gitignore의 보호 범위를 보장할 수 없어 쓰기 전에 중단합니다.`);
      }
    }
    return;
  }
  const probes = [`${config.artifactsDir}/run.json`, '.claude/settings.local.json', '.claude/claude-progress.txt', '.claude/feature_list.json', '.claude/logs/run.jsonl'];
  // --no-index checks rules even for tracked files; it does not untrack existing private data.
  const output = git(root, ['check-ignore', '--no-index', '--verbose', '--stdin', '-z'], `${probes.join('\0')}\0`, [0, 1]).split('\0');
  for (const probe of probes) {
    let ignored = false;
    for (let i = 0; i + 3 < output.length; i += 4) {
      if (output[i + 3] !== probe) continue;
      ignored = !output[i + 2]!.startsWith('!');
    }
    if (!ignored) throw new Error(`${probe}: 하위 .gitignore 등의 규칙이 Git 제외를 막고 있습니다. 제외 규칙을 확인하세요.`);
  }
}

function makeParents(root: string, path: string, created: string[]): void {
  const parts = path.split('/').slice(0, -1);
  for (let i = 1; i <= parts.length; i++) {
    const parent = parts.slice(0, i).join('/');
    if (!inspect(root, parent)) {
      fs.mkdirSync(join(root, parent));
      created.push(parent);
    }
  }
}

export function runInit(options: InitOptions = {}): InitResult {
  const result: InitResult = {
    schemaVersion: 1, command: 'init', dryRun: options.dryRun ?? false, root: null,
    status: 'failed', templateVersion: null, config: null, files: [], createdDirectories: [], errors: [], warnings: [], exitCode: 2,
  };
  try {
    for (const key of ['cwd', 'target', 'configPath', 'templateDirectory'] as const) {
      if (options[key] === '') throw new Error(`${key}: 빈 경로 대신 실제 경로를 지정하거나 옵션을 생략하세요.`);
    }
    const cwd = resolve(options.cwd ?? process.cwd());
    const target = directory(resolve(cwd, options.target ?? '.'));
    if (git(target, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true') throw new Error('일반 Git 작업 트리에서 실행하세요. bare 저장소는 지원하지 않습니다.');
    const root = directory(git(target, ['rev-parse', '--show-toplevel']).trim());
    const within = relative(root, target);
    if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) throw new Error('대상 경로와 Git 루트가 일치하지 않습니다.');
    result.root = root;
    const configPath = options.configPath === undefined ? join(root, 'dev-cycle.config.json') : resolve(cwd, options.configPath);
    directory(dirname(configPath));
    const configFile = fs.lstatSync(configPath);
    if (!configFile.isFile() || configFile.isSymbolicLink()) throw new Error(`${configPath}: 설정은 링크가 아닌 일반 JSON 파일이어야 합니다.`);
    const config = parseWorkflowConfig(readJson(configPath));
    result.config = config;

    const templates = directory(options.templateDirectory === undefined ? templateDirectory() : resolve(cwd, options.templateDirectory));
    if (!inspect(templates, 'manifest.json')?.isFile()) throw new Error('manifest.json이 일반 파일이 아닙니다.');
    const manifest = record(readJson(join(templates, 'manifest.json')));
    if (manifest.schemaVersion !== 1 || typeof manifest.templateVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(manifest.templateVersion)
      || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('manifest: 버전 1, templateVersion과 비어 있지 않은 files 목록이 필요합니다.');
    result.templateVersion = manifest.templateVersion;
    const packageRoot = portablePath(manifest.root);
    if (!inspect(templates, packageRoot)?.isDirectory()) throw new Error('manifest.root: 템플릿 디렉터리가 없습니다.');
    const sources = join(templates, packageRoot);
    const contents = new Map<InitFile, string>();
    const targets = new Map<string, string>();
    for (const raw of manifest.files as unknown[]) {
      const file: InitFile = { path: String(record(raw).target), status: 'error', message: '' };
      result.files.push(file);
      try {
        const entry = record(raw);
        const path = portablePath(entry.target);
        const source = portablePath(entry.source);
        const key = path.toLowerCase();
        for (const [otherKey, other] of targets) {
          if (key === otherKey || key.startsWith(`${otherKey}/`) || otherKey.startsWith(`${key}/`)) throw new Error(`${path}: manifest 대상 경로가 ${other}와 중복/충돌합니다.`);
          const a = path.split('/'); const b = other.split('/');
          for (let i = 0; i < Math.min(a.length, b.length) && a[i]!.toLowerCase() === b[i]!.toLowerCase(); i++) {
            if (a[i] !== b[i]) throw new Error(`${path}: manifest 디렉터리 대소문자가 ${other}와 충돌합니다.`);
          }
        }
        targets.set(key, path);
        if (!inspect(sources, source)?.isFile()) throw new Error(`${source}: 템플릿이 일반 파일이 아닙니다.`);
        const content = renderWorkflowTemplate(fs.readFileSync(join(sources, source), 'utf8'), config);
        contents.set(file, content);
        inspectFile(root, file, content, config);
      } catch (error) { file.status = 'error'; file.message = message(error); result.errors.push(file.message); }
    }

    const artifacts = inspect(root, config.artifactsDir);
    if (artifacts && !artifacts.isDirectory()) throw new Error(`${config.artifactsDir}: 산출물 경로가 디렉터리가 아닙니다.`);
    if (git(root, ['--literal-pathspecs', 'ls-files', '-z', '--', config.artifactsDir])) throw new Error(`${config.artifactsDir}: Git으로 추적하는 파일이 있습니다. 소스와 겹치지 않는 산출물 디렉터리를 지정하세요.`);
    const ignore = result.files.find((file) => file.path === '.gitignore');
    if (ignore?.status === 'create' || ignore?.status === 'unchanged') checkIgnored(root, config, ignore.status === 'create');
    for (const path of Object.values(config.paths)) {
      if (!stat(join(root, path))) result.warnings.push(`${path}: 프로젝트 지침/양식이 없습니다. 사용하는 기능에 맞게 직접 준비하세요.`);
    }
    result.warnings.push('개인 권한, 실제 메모/로그와 산출물은 커밋하지 마세요. 이미 추적 중인 파일은 .gitignore만으로 제외되지 않습니다. 외부 grill-me 설치는 사용 가이드를 따르세요.');
    if (result.errors.length) return result;
    if (result.files.some((file) => file.status === 'conflict')) {
      result.status = 'blocked'; result.exitCode = 1; return result;
    }
    if (result.dryRun) { result.status = 'ready'; result.exitCode = 0; return result; }

    for (const file of result.files) {
      if (file.status === 'unchanged') continue;
      let descriptor: number | undefined;
      try {
        // Recheck immediately before writing; exclusive creation never truncates a raced-in file.
        directory(root);
        const status = inspectFile(root, file, contents.get(file)!, config);
        if (status === 'unchanged') continue;
        if (status !== 'create') throw new Error(`${file.path}: 점검 이후 대상이 변경됐습니다. 다시 계획을 확인하세요.`);
        makeParents(root, file.path, result.createdDirectories);
        if (inspect(root, file.path)) throw new Error(`${file.path}: 점검 이후 파일이 생성됐습니다.`);
        descriptor = fs.openSync(join(root, file.path), 'wx');
        file.partial = true;
        const data = Buffer.from(contents.get(file)!, 'utf8');
        let offset = 0;
        while (offset < data.length) {
          const written = fs.writeSync(descriptor, data, offset, data.length - offset);
          if (written === 0) throw new Error('파일 쓰기가 진행되지 않았습니다.');
          offset += written;
        }
        fs.closeSync(descriptor); descriptor = undefined;
        delete file.partial;
        file.status = 'created'; file.message = '새 파일을 생성했습니다.';
      } catch (error) {
        file.status = 'error';
        file.message = `${message(error)} 생성된 파일/디렉터리와 불완전한 파일을 확인하고 권한/디스크 문제를 해결한 뒤 재실행하세요. 기존 파일을 자동 삭제하거나 되돌리지 않습니다.`;
        result.errors.push(file.message);
        for (const pending of result.files.filter((item) => item.status === 'create')) {
          pending.status = 'not-created'; pending.message = '앞선 쓰기 실패로 생성하지 않았습니다.';
        }
        return result;
      } finally {
        if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* Keep the original failure and partial-file report. */ } }
      }
    }
    result.status = 'completed'; result.exitCode = 0;
  } catch (error) {
    result.errors.push(message(error));
    if (!result.config) result.errors.push('설정 예시를 프로젝트에 맞게 수정해 --config <파일>로 지정하거나 Git 루트의 dev-cycle.config.json을 준비하세요.');
  }
  return result;
}
