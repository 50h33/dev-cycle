# dev-cycle
AI 개발 흐름과 테스트를 관리하는 TypeScript CLI

## 워크플로 템플릿

TicketRush의 기존 Claude Code 에이전트, 명령과 스킬을 추출해 다른 저장소에서도
사용할 수 있도록 프로젝트별 설정을 분리합니다. 배포 파일은 `templates/workflow/`,
설정 예시는 [`examples/dev-cycle.config.json`](examples/dev-cycle.config.json)에 있습니다.

[추출 파일 대응, 설정 계약과 설치 방법](docs/workflow-package.md)을 먼저 확인하세요.
현재는 템플릿과 설정 검증, 기존 파일을 보존하는 `init` 설치, Gradle 변경 모듈의
`test` 실행 및 결과 기록, 그 기록으로 PR 검증 블록을 만드는 `report`를 제공합니다.

## init으로 설치

먼저 dev-cycle 저장소에서 의존성을 설치하고 CLI를 빌드합니다.

```sh
npm ci
npm run build
```

대상 저장소에 맞춘 설정 파일을 준비한 뒤, 실제 변경 전에 dry-run으로 전체 계획을 확인합니다.

```sh
node /absolute/path/to/dev-cycle/dist/cli.js init /absolute/path/to/project \
  --config /absolute/path/to/project-config.json \
  --dry-run
```

충돌과 오류가 없으면 `--dry-run`만 제거해 설치합니다. 대상 Git 루트에 이미
`dev-cycle.config.json`이 있으면 `--config`를 생략할 수 있습니다. 설정 파일 경로는
명령을 실행한 디렉터리를 기준으로 해석하며 저장소명, 기본 브랜치나 명령을 추정하지 않습니다.
자동화에서는 `--json`을 추가해 같은 계획과 오류를 JSON 한 개로 받습니다.

기존 파일과 내용이 다르면 덮어쓰거나 자동 병합하지 않고 전체 설치를 중단합니다.
상세한 충돌 처리, 종료 코드와 실패 복구 방법은 [init 사용법](docs/init.md)을 확인하세요.

## 변경 모듈 테스트

```sh
node /absolute/path/to/dev-cycle/dist/cli.js test /absolute/path/to/project --dry-run --json
node /absolute/path/to/dev-cycle/dist/cli.js test /absolute/path/to/project
```

정적 Groovy `settings.gradle`의 최상위 모듈과 Gradle Wrapper를 지원합니다. 비교 ref와
프로젝트별 공통 모듈은 설정하며, 미분류 변경은 전체 테스트로 확대합니다. 실제 종료 상태,
이번 실행의 XML 증거와 실행 전후 코드 지문을 기록합니다. 캐시나 이전 결과를 새 테스트
통과로 표시하지 않습니다. [지원 문법, Windows 인자 제한과 기록 계약](docs/test.md)을 확인하세요.

## 실행 기록으로 보고서 만들기

```sh
node /absolute/path/to/dev-cycle/dist/cli.js report /absolute/path/to/project
node /absolute/path/to/dev-cycle/dist/cli.js report /absolute/path/to/project --json
node /absolute/path/to/dev-cycle/dist/cli.js report /absolute/path/to/project \
  --output .dev-cycle/reports/pr-tests.md
```

`report`는 기본적으로 가장 최근에 시작한 실행 기록을 선택해 PR 본문에 붙일 Markdown을
stdout으로 출력합니다. 최신 기록이 실패, 중단, 생략 또는 미실행이면 그 상태를 그대로
표시하며 과거 성공 기록으로 대체하지 않습니다. 현재 코드나 설정이 실행 시점과 달라졌으면
현재 코드를 검증하지 않은 결과라고 명시합니다. 기록에 없는 실패 테스트 이름, 커버리지,
수동 시연이나 원격 CI 결과는 만들지 않습니다.

파일 출력은 설정한 `artifactsDir` 아래 `reports/`에만 새 파일로 저장할 수 있으며 기존 파일을
덮어쓰지 않습니다. `--dry-run`은 파일을 만들지 않습니다. 선택 규칙, 상태 해석과 출력 경계는
[report 사용법](docs/report.md)을 확인하세요.

설치부터 보고서까지의 기본 흐름은 다음과 같습니다.

1. `init --dry-run`으로 설치 계획과 충돌을 확인합니다.
2. `init`을 적용하고 다시 실행해 모든 파일이 `unchanged`인지 확인합니다.
3. `test --dry-run`으로 선택 대상과 이유를 확인합니다.
4. `test`를 실행해 실제 종료 상태와 증거를 기록합니다.
5. `report`로 현재 코드와 기록을 비교한 Markdown을 만듭니다.

테스트나 report가 실패하면 원인을 수정한 뒤 테스트를 새로 실행합니다. 과거 기록은
덮어쓰지 않으며, 새 기록으로 report를 다시 생성합니다. 커밋, push, PR 게시와 머지는 CLI가
수행하지 않고 대상 저장소의 지침과 사용자가 승인한 범위에 따라 별도로 진행합니다.

## 개발 환경

- Node.js 22.x (22.17.0 이상), npm 10 이상, Git
- `.nvmrc`는 Node.js 22 계열을 지정합니다. CI도 같은 계열을 사용합니다.
- GitHub 이슈·PR 작업 스킬을 사용할 때는 GitHub CLI(`gh`)와 저장소 접근 권한이 필요합니다.

저장소 루트에서 실행합니다.

```sh
npm ci
npm run check
```

`npm ci`는 lockfile에 고정된 개발 의존성을 설치하고 `prepare` 단계에서
이 저장소의 `core.hooksPath`를 `.githooks`로 설정합니다. 기존 사용자 전역 Git 설정은 변경하지 않습니다.
`--ignore-scripts`로 설치했다면 `npm run prepare`를 별도로 실행해야 합니다.

## 검증 명령

| 명령 | 수행 내용 |
| --- | --- |
| `npm run lint` | TypeScript와 개발 스크립트의 ESLint 검사 |
| `npm run typecheck` | 소스와 테스트의 strict 타입 검사, 파일 출력 없음 |
| `npm test` | TypeScript 테스트를 `.test-dist/`로 컴파일하고 Node 내장 테스트 러너로 실행 |
| `npm run build` | 이전 `dist/`를 비우고 `src/`를 컴파일 |
| `npm run check` | lint → 타입 검사 → 테스트 → 빌드 순서로 전체 검증 |

현재 테스트는 실제 `commit-msg` 훅과 배포 템플릿, 설정 검사와 프로젝트별 렌더링을
비롯해 init 설치 계획, 충돌과 재실행, Git 변경 분석, 테스트 실행과 결과 기록, 기록 기반 report를 확인합니다. 테스트 실행 전에 이전
`.test-dist/` 산출물을 지웁니다.

## 작업 규칙과 CI

- 공통 작업 규칙: [AGENTS.md](AGENTS.md), Claude 진입점: [CLAUDE.md](CLAUDE.md)
- 작업 브랜치: `main` 기준 `{이슈 라벨}/{이슈 번호}` (예: `chore/1`)
- 커밋 메시지: `[Chore] #1 TypeScript 개발 환경 구성`
- PR 제목: 같은 형식을 사용하며 여러 이슈 번호도 허용합니다. 예: `[Chore] #1, #2 개발 환경 보완`
- 이슈·PR 양식과 이슈 작성·PR 작성·리뷰 반영 스킬은 `AGENTS.md`에서 안내합니다.

코드 검증 CI는 `main`으로 향하는 PR, `main` push 또는 수동 실행 시 Windows와 Ubuntu에서
설치·lint·타입 검사·테스트·빌드를 실행합니다. PR 제목 검사는 PR 생성·제목 편집·재개·커밋 추가 시 실행됩니다.
로컬 검증 결과와 GitHub Actions 실행 결과는 구분하여 기록합니다.

## 초기 검증 결과

2026-11-09, Windows / Node.js 22.17.0 / npm 10.9.2 기준:

- 설치, lint, 타입 검사, 커밋 훅 테스트 23개, 빌드 통과.
- PR 제목 검사 22개 사례와 YAML·문서 링크 검사 통과.
- `npm audit`: 개발 의존성의 `minimatch` 관련 moderate 경고 10건.
  현재 호환 범위 내 수정 버전이 없으며, `npm audit --omit=dev` 결과는 0건입니다.
- GitHub Actions와 Ubuntu 러너, 이슈·PR·리뷰 스킬의 실제 게시 동작은 미검증입니다.
