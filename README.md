# dev-cycle

Claude Code 개발 워크플로를 다른 저장소에 설치하고, 실제 테스트 결과와 코드 상태를 기록하는 TypeScript CLI.

## 왜 만들었나요?

TicketRush에서는 이슈 확인, 조사, 계획, 구현, 테스트, 리뷰와 PR 정리를 Claude Code의
에이전트·명령·스킬로 반복했다. 이 절차를 다른 프로젝트에서도 쓰려면 고정된 `develop` 브랜치,
공통 모듈 이름과 문서 경로를 분리해야 했다. 또한 도구를 호출했다는 로그만으로는 테스트가
끝났는지 알 수 없고, 이전 성공 결과가 수정된 현재 코드에도 유효한지 따로 확인해야 했다.

dev-cycle은 재사용할 템플릿과 프로젝트별 설정을 분리하고, 반복 가능한 설치·실행·기록을
CLI로 옮겼다. 조사, 코드 작성과 리뷰 판단은 Claude Code가 담당한다. 추출 범위와 선택 이유는
[MVP 설계 이슈 #3](https://github.com/50h33/dev-cycle/issues/3)과
[원본/배포 파일 대응](docs/workflow-package.md)에 기록돼 있다. 사용자 도입 성과나 시간 절감은 아직 측정하지 않았다.

## 현재 할 수 있는 일

| 명령 | 역할 | 레퍼런스 |
| --- | --- | --- |
| `init` | 설치 계획과 충돌을 확인하고 공유 템플릿을 설치. 기존 파일 보존 | [설치와 복구](docs/init.md) |
| `test` | Git 변경에 따라 Gradle 테스트를 선택·실행하고 종료 상태, XML 증거와 코드 지문을 저장 | [지원 문법과 기록 계약](docs/test.md) |
| `report` | 저장된 결과와 현재 코드 상태를 비교해 PR용 Markdown 초안 생성 | [기록 선택과 신선도](docs/report.md) |

Node.js 22.17.0 이상 22 계열, npm 10 이상과 Git을 사용한다. CLI CI는 Windows와 Ubuntu에서
실행한다. `test`는 JDK, 루트 Gradle Wrapper와 정적 Groovy `settings.gradle`의 최상위 모듈,
표준 `test` 태스크/기본 XML 위치를 지원한다. Kotlin DSL, 동적 설정, 중첩/composite build,
사용자 정의 테스트 태스크와 다른 빌드 시스템은 지원하지 않는다.

CLI는 LLM을 호출하거나 커밋, push, PR 게시·머지를 수행하지 않는다. 종료점은 로컬 실행 기록과
Markdown 초안이다. Claude Code에서 GitHub 이슈·PR 스킬까지 사용하려면 별도로 `gh`와 저장소 권한이 필요하다.

## 시작하기

현재 안내하는 실행 방식은 소스 빌드다. npm 공개 배포를 전제로 하지 않는다.
먼저 이 저장소를 clone한 디렉터리에서 실행한다.

```sh
npm ci
npm run build
node /absolute/path/to/dev-cycle/dist/cli.js --help
```

`/absolute/path/to/dev-cycle`을 빌드한 저장소의 실제 경로로 바꾸고, 공백이 있는 경로는 따옴표로 감싼다.
설정 예시는 [`examples/dev-cycle.config.json`](examples/dev-cycle.config.json)에 있다.
설정 파일을 대상 저장소에 맞게 준비한 뒤 다음 순서로 진행한다.

```sh
node /absolute/path/to/dev-cycle/dist/cli.js init /path/to/project --config /path/to/project-config.json --dry-run
node /absolute/path/to/dev-cycle/dist/cli.js init /path/to/project --config /path/to/project-config.json
node /absolute/path/to/dev-cycle/dist/cli.js test /path/to/project --dry-run --json
node /absolute/path/to/dev-cycle/dist/cli.js test /path/to/project
node /absolute/path/to/dev-cycle/dist/cli.js report /path/to/project
```

설치 계획이 `ready`일 때 적용한다. 기존 파일과 다르면 `blocked`로 중단하므로
[충돌 처리](docs/init.md#계획과-충돌)를 먼저 따른다. 설치된 설정은 이후 명령이 대상 Git 루트에서 읽는다.
`test`에는 실제로 존재하는 비교 ref와 HEAD 커밋이 필요하다.

**처음 사용한다면 [최소 Gradle 예제로 따라 하기](docs/quickstart.md)를 확인하세요.**
별도 작업 디렉터리, 설정과 기준 커밋 준비부터 실제 테스트 한 개, 성공 보고서와 코드 변경 후
`changed` 결과까지 재현한다. 실측 출력과 재현 조건도 함께 제공한다.

## 설계 선택과 이유

| 선택 | 해결하려는 문제와 제약 | 코드 근거 |
| --- | --- | --- |
| 프로젝트 설정 분리 | 브랜치·공통 모듈·문서 경로를 복사본마다 수정하지 않도록 설정으로 받는다. 원격이나 저장소명으로 추정하지 않는다. | [`parseWorkflowConfig`](src/workflow.ts), [설정 계약](docs/workflow-package.md) |
| 정적 Gradle 범위 | settings를 실행하지 않고 지원 문법만 읽어 dry-run 중 빌드 실행을 피한다. 임의 의존 그래프를 추론하지 않으므로 미지원 문법은 중단하고 공통 영향은 설정해야 한다. | [`parseGradleSettings`](src/test-selection.ts) |
| 미분류 변경은 전체 테스트 | 모듈명과 일치하지 않는 경로를 버리면 빌드/공통 설정 변경을 놓칠 수 있다. 실행량이 늘더라도 전체 테스트로 확대하고 이유를 남긴다. 문서 생략은 명시한 경로에만 적용한다. | [`selectTests`](src/test-selection.ts) |
| 종료 상태 + XML + 코드 지문 | 종료 0만으로 새 테스트 실행을 증명할 수 없고 과거 XML도 재사용될 수 있다. 실제 실행 태스크의 새 XML을 확인하고 HEAD뿐 아니라 index·작업 트리·설정을 비교해 수정 후 성공 오인을 줄인다. | [증거 수집](src/test-process.ts), [지문](src/test-git.ts), [실행](src/test.ts), [보고서](src/report.ts) |
| `unknown` 입력 검증과 strict 타입 | 외부 JSON의 구조를 검증하기 전에 신뢰하지 않는다. 오타 키, 잘못된 경로·ref·명령을 항목별 오류로 돌려준다. `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`는 null/undefined, 없는 배열·사전 항목과 선택 필드의 잘못된 취급을 컴파일 단계에서 드러낸다. 런타임 검증을 대신하지 않는다. | [`parseWorkflowConfig(unknown)`](src/workflow.ts), [`tsconfig.json`](tsconfig.json) |

`succeeded`는 프로세스 성공 상태이며 새 테스트 통과 수와 별개다. `UP-TO-DATE`와 `FROM-CACHE`는
새 통과로 집계하지 않는다. `report`는 최신 실패·중단·생략을 과거 성공으로 대체하지 않으며,
기록 이후 코드가 바뀌면 `changed`로 표시한다. 상세 상태는 [test](docs/test.md#상태와-종료-코드)와
[report](docs/report.md#신선도와-현재-코드)의 계약을 따른다.

## 검증 현황

### 최신 main의 CLI CI

2026-11-12에 다시 확인한 최신 `main`은
[`431cbb5`](https://github.com/50h33/dev-cycle/commit/431cbb5d5ccd14509939e91d1cea3e39b2305039)다.
[GitHub Actions 실행](https://github.com/50h33/dev-cycle/actions/runs/42656519909)은 2026-11-09 UTC에
두 OS 모두 설치·lint·타입 검사·테스트·빌드를 통과했다. 아래 수치는 각 job의 실제 로그 기준이다.

| 환경 | Node.js | 전체 | 통과 | 실패 | 생략 |
| --- | --- | ---: | ---: | ---: | ---: |
| [Windows](https://github.com/50h33/dev-cycle/actions/runs/42656519909/job/129296333680) | 22.23.4 | 162 | 159 | 0 | 3 |
| [Ubuntu](https://github.com/50h33/dev-cycle/actions/runs/42656519909/job/129296333584) | 22.23.4 | 162 | 158 | 0 | 4 |

Windows에서 생략한 3개는 비 UTF-8 Git 파일명, POSIX 프로세스 강제 종료와 파일 권한 검사다.
Ubuntu에서 생략한 4개는 Windows 8.3 경로 검사 2개, 소문자 Git 환경변수와 배치 Wrapper 검사다.
핵심 테스트는 임시 Git 저장소와 Node stub을 사용하므로 이 CI 통과가 실제 Gradle이나 Claude Code
동작까지 검증했다는 뜻은 아니다.

### 실제 Gradle과 Claude Code

- 2026-11-09/10의 Windows / Java 21.0.6 / Gradle 9.3.0 격리 프로젝트 검증은
  [test 기록](docs/test.md#검증-경계)과 [전체 흐름 기록](docs/report.md#실제-환경-검증-기록)에 있다.
  성공·실패·`UP-TO-DATE`·중단과 코드 변경 후 신선도를 확인했다.
- 이번 문서의 재현 실행 환경과 성공/`changed` 출력은 [따라 하기의 실측 기록](docs/quickstart.md#실측-출력과-검증-범위)에 있다.
- 실제 Ubuntu Gradle과 TicketRush의 DB/Redis/Kafka 의존 통합 테스트는 미실행이다.
  TicketRush 원본은 dry-run만 확인했으며 설치나 테스트를 실행하지 않았다.
- Claude Code 템플릿 구조/렌더링 검사와 strict validator 종료 0은 확인했지만, validator의
  `contents`는 빈 배열이었다. `/agents` 발견, 모델 실행과 GitHub 게시 동작은 미검증이다.
  [검증 경계](docs/workflow-package.md#검증-경계)를 참고한다.

### 초기 기록과의 구분

2026-11-09 초기 환경 구성([PR #2](https://github.com/50h33/dev-cycle/pull/2)) 당시의 로컬 Windows /
Node.js 22.17.0 / npm 10.9.2 검증은 설치·lint·타입 검사·커밋 훅 테스트 23개·빌드와 PR 제목 22개 사례였다.
당시 README의 GitHub Actions/Ubuntu 미검증 표시는 초기 시점의 기록이며 위 최신 CI 결과로 갱신했다.
초기 `npm audit`의 개발 의존성 moderate 10건, `--omit=dev` 0건도 당시 기록이다. 현재 보안 상태를
보장하는 수치로 사용하지 않는다.

## 개발 및 기여

저장소 루트에서 `npm ci` 후 `npm run check`로 전체 검증한다. `npm ci`의 `prepare`는
이 저장소의 `core.hooksPath`를 `.githooks`로 설정한다. 전역 Git 설정은 바꾸지 않는다.
`--ignore-scripts`로 설치했다면 `npm run prepare`를 따로 실행한다.

| 명령 | 수행 내용 |
| --- | --- |
| `npm run lint` | TypeScript와 개발 스크립트의 ESLint 검사 |
| `npm run typecheck` | 소스와 테스트의 strict 타입 검사 |
| `npm test` | 이전 `.test-dist/`를 비우고 Node 내장 테스트 러너 실행 |
| `npm run build` | 이전 `dist/`를 비우고 CLI 컴파일 |
| `npm run check` | lint → 타입 검사 → 테스트 → 빌드 |

공통 규칙은 [AGENTS.md](AGENTS.md), Claude 진입점은 [CLAUDE.md](CLAUDE.md)다.
작업 브랜치는 `main` 기준 `{이슈 라벨}/{이슈 번호}`이며 커밋·PR 제목은
`[Docs] #12 사용 가이드 보완` 형식을 사용한다. 이슈·PR·리뷰 스킬과 양식은 AGENTS.md에서 안내한다.
CI는 `main` 대상 PR, `main` push와 수동 실행에서 동작하며 PR 제목 검사도 별도로 실행한다.
