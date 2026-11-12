# dev-cycle

Gradle 프로젝트에서 변경된 코드에 맞는 테스트를 실행하고, 결과를 PR에 붙일 수 있도록 정리하는
TypeScript CLI입니다. Claude Code용 에이전트·명령·스킬 파일도 설치할 수 있습니다.

## 주요 기능

| 명령 | 하는 일 | 자세한 사용법 |
| --- | --- | --- |
| `init` | 대상 저장소에 Claude Code용 파일과 설정을 설치합니다. 기존 파일과 충돌하면 덮어쓰지 않고 중단합니다. | [설치와 충돌 처리](docs/init.md) |
| `test` | Git 변경을 읽어 Gradle 테스트를 선택하고 실행합니다. 결과와 테스트 당시 코드 상태를 함께 기록합니다. | [테스트 실행](docs/test.md) |
| `report` | 최근 테스트 결과를 Markdown으로 정리합니다. 테스트 후 코드가 바뀌었는지도 표시합니다. | [보고서 만들기](docs/report.md) |

`test`와 `report`는 Claude Code 없이 사용할 수 있습니다. `init`으로 설치되는 파일의 종류와
용도는 [템플릿 안내](docs/workflow-package.md)를 참고하세요.

## 지원 환경

- Node.js 22.17.0 이상 22 계열, npm 10 이상, Git
- Windows 또는 Ubuntu
- 테스트할 프로젝트의 JDK와 루트 Gradle Wrapper(`gradlew`, Windows에서는 `gradlew.bat`)
- Groovy `settings.gradle`에 `include 'app'`처럼 이름을 직접 적은 최상위 모듈
- 표준 `test` 태스크와 기본 XML 결과 경로(`build/test-results/test/*.xml`)

Kotlin DSL, 동적 모듈 설정, 중첩 모듈, composite build, 사용자 정의 테스트 태스크와 다른 빌드
시스템은 지원하지 않습니다. 자세한 조건은 [지원하는 프로젝트](docs/test.md#지원하는-프로젝트)에 있습니다.

## 시작하기

이 저장소를 clone한 디렉터리에서 의존성을 설치하고 CLI를 빌드하세요.

```sh
npm ci
npm run build
```

[`설정 파일 예시`](examples/dev-cycle.config.json)를 복사해 테스트할 저장소에 맞게 수정하세요.
저장소명, 기본 브랜치, 비교 ref, 문서 경로와 테스트 명령을 직접 지정해야 합니다.

아래 경로를 실제 위치로 바꾼 뒤 실행하세요. 경로에 공백이 있으면 따옴표로 감싸야 합니다.

```sh
node /path/to/dev-cycle/dist/cli.js init /path/to/project --config /path/to/project-config.json --dry-run
node /path/to/dev-cycle/dist/cli.js init /path/to/project --config /path/to/project-config.json
node /path/to/dev-cycle/dist/cli.js test /path/to/project --dry-run --json
node /path/to/dev-cycle/dist/cli.js test /path/to/project
node /path/to/dev-cycle/dist/cli.js report /path/to/project
```

첫 번째 명령은 설치할 파일을 미리 보여줍니다. 결과가 `ready`이면 두 번째 명령으로 설치할 수
있습니다. `blocked`가 나오면 [충돌 처리](docs/init.md#계획과-충돌)를 먼저 확인하세요.
설치 후에는 대상 저장소의 `dev-cycle.config.json`을 자동으로 읽습니다.

`test --dry-run`은 실행할 테스트와 선택 이유만 보여줍니다. 실제 테스트를 실행하려면
`--dry-run`을 빼야 합니다. 테스트할 저장소에는 HEAD 커밋과 비교할 ref가 있어야 합니다.
설정 준비부터 보고서 저장까지는 [시작 가이드](docs/quickstart.md)를 참고하세요.

## 테스트 결과 읽기

테스트 실행 결과는 기본적으로 `.dev-cycle/runs/`에 저장됩니다. `report`는 가장 최근에 시작한
실행을 읽어 Markdown을 출력합니다. 최신 테스트가 실패했으면 실패 결과를 그대로 보여줍니다.

테스트 성공 여부와 코드 변경 여부는 별개입니다. `freshness`는 테스트 당시 코드와 현재 코드가
같은지 나타내며, CLI 출력에서는 ‘코드 신선도’로 표시됩니다.

| 표시 | 의미 |
| --- | --- |
| `succeeded` + `current` | Gradle 프로세스가 성공했고, 코드와 설정도 실행 당시와 같습니다. 새 테스트 실행 여부는 XML 결과를 확인하세요. |
| `succeeded` + `changed` | Gradle 프로세스는 성공했지만, 실행 중이나 이후에 코드·설정 등이 바뀌었습니다. 다시 테스트해야 합니다. |
| `unknown` 또는 `incomplete` | 코드 상태를 비교할 수 없거나 실행이 끝난 기록이 없습니다. 현재 코드가 검증됐다고 볼 수 없습니다. |

프로세스가 성공했다고 테스트를 새로 실행한 것은 아닐 수 있습니다. Gradle의 `UP-TO-DATE`나
`FROM-CACHE` 결과는 새 테스트 통과 수에 넣지 않습니다. 실제로 실행한 태스크의 새 XML 결과만
집계합니다. `report`의 종료 코드 0도 테스트 통과가 아니라 보고서를 만들었다는 뜻입니다.

CLI는 로컬 테스트와 보고서 작성까지 수행합니다. 커밋, push, PR 게시·머지는 별도 작업입니다.

## 검증 현황

2026-11-12에 확인한 `main` 커밋
[`431cbb5`](https://github.com/50h33/dev-cycle/commit/431cbb5d5ccd14509939e91d1cea3e39b2305039)의
[GitHub Actions 결과](https://github.com/50h33/dev-cycle/actions/runs/42656519909)입니다.
두 OS 모두 의존성 설치, lint, 타입 검사, 테스트, 빌드를 통과했습니다.

| 환경 | Node.js | 전체 | 통과 | 실패 | 생략 |
| --- | --- | ---: | ---: | ---: | ---: |
| [Windows](https://github.com/50h33/dev-cycle/actions/runs/42656519909/job/129296333680) | 22.23.4 | 162 | 159 | 0 | 3 |
| [Ubuntu](https://github.com/50h33/dev-cycle/actions/runs/42656519909/job/129296333584) | 22.23.4 | 162 | 158 | 0 | 4 |

Windows에서는 POSIX 전용 검사 3개, Ubuntu에서는 Windows 전용 검사 4개를 생략했습니다.
CI는 임시 Git 저장소와 Gradle 대신 실행하는 Node stub으로 CLI 동작을 검사합니다.

실제 Gradle 실행은 Windows / Java 21.0.6 / Gradle 9.3.0에서 확인했습니다.
[검증 기록](docs/report.md#실제-환경-검증-기록)에 성공·실패·중단과 테스트 후 코드 변경 결과가 있습니다.
실제 Ubuntu Gradle 실행과 외부 서비스가 필요한 통합 테스트는 확인하지 않았습니다.
Claude Code 템플릿의 구조와 렌더링은 검사했지만, 실제 에이전트·모델 실행은 확인하지 않았습니다.

## 개발 및 기여

저장소 루트에서 `npm run check`로 전체 검사를 실행할 수 있습니다.

| 명령 | 수행 내용 |
| --- | --- |
| `npm run lint` | ESLint 검사 |
| `npm run typecheck` | 소스와 테스트의 strict 타입 검사 |
| `npm test` | Node 내장 테스트 러너로 테스트 실행 |
| `npm run build` | CLI 컴파일 |
| `npm run check` | lint → 타입 검사 → 테스트 → 빌드 |

`npm ci`는 `prepare` 단계에서 이 저장소의 `core.hooksPath`를 `.githooks`로 설정합니다.
`--ignore-scripts`로 설치했다면 `npm run prepare`를 따로 실행하세요.
작업 규칙과 이슈·PR 양식은 [AGENTS.md](AGENTS.md), Claude Code용 안내는 [CLAUDE.md](CLAUDE.md)를
참고하세요.
