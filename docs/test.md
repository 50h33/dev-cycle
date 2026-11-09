# 변경 모듈 테스트와 실행 기록

TicketRush의 `/test`에서 사용하던 변경 모듈 선택, Wrapper 실행, 실제 결과 보고 흐름을
독립 CLI로 옮겼다. 원본의 `develop`, `common`과 모듈 외 경로 무시 규칙은 사용하지 않는다.
코드 작성과 리뷰 판단은 Claude Code가 담당한다. CLI는 Git과 설정을 읽고 프로세스를 실행한다.

## 사용

```sh
dev-cycle test /path/to/project --dry-run --json
dev-cycle test /path/to/project
dev-cycle test /path/to/project --base-ref origin/trunk --config /path/to/config.json --json
```

소스 저장소에서는 `npm run build` 후 `node /path/to/dev-cycle/dist/cli.js test ...`로 실행한다.
대상 경로를 생략하면 현재 디렉터리에서 Git 루트를 찾는다. `--config`는 호출한 디렉터리
기준이고, 생략하면 대상 Git 루트의 `dev-cycle.config.json`을 사용한다. `--base-ref`가 설정의
`baseRef`보다 우선하며, 설정의 `baseRef`가 없으면 `defaultBranch`를 사용한다.
기준 ref와 HEAD의 commit 및 merge-base를 확인한다. ref 오류나 커밋 없는 저장소는 중단하며
자동 fetch, 브랜치 추정이나 Git 설정 변경을 하지 않는다.

`--dry-run`은 선택과 명령을 반환하며 Wrapper, 로그, 기록, 캐시를 만들거나 실행하지 않는다.
정상 preview의 상태는 `not-run`이고 종료 코드는 0이다. JSON에서는 stdout에 JSON 객체
하나만 출력한다. 실제 실행의 원문 stdout/stderr는 제한된 로컬 파일에 저장한다.

## 지원하는 프로젝트

- Node.js 22.17 이상 22 계열, Git, Windows 또는 Ubuntu, 프로젝트의 JDK와 Gradle Wrapper.
- 루트의 Groovy `settings.gradle`에 선언한 정적 최상위 모듈. 설정 파일을 평가하지 않는다.
- `rootProject.name = 'name'`, `include 'api'`, `include 'api', 'shared'`,
  `include('api', 'shared')`, 괄호 안 여러 줄, 주석과 공백.
- `projectDir`, `includeBuild`, 중첩 모듈, Kotlin DSL, 동적 Groovy, plugins 블록 등
  지원 문법 밖의 설정은 부분 분석으로 진행하지 않고 이유를 표시한다.
- Git 충돌, submodule과 소스의 symlink/junction은 명확히 중단한다.
- partial clone/promisor 저장소는 읽기 중 누락된 객체를 자동 다운로드할 수 있어 분석 전에 거부한다.
  원격 객체가 모두 있는 일반 로컬 복사본을 사용한다.
- 최상위 모듈 이름 `build`는 루트 Gradle 산출물 경로와 겹쳐 지원하지 않는다.
  모듈명과 산출물 경로의 대소문자는 실제 디렉터리 이름과 일치해야 한다.
- 표준 `test` 태스크와 기본 `build/test-results/test/*.xml` 위치를 사용한다.
  임의 의존 그래프, 사용자 정의 테스트 태스크와 XML 위치는 추론하지 않는다.

설정 형식은 [워크플로 계약](workflow-package.md)을 따른다. `commands.test`의 실행 파일은
이 어댑터에서 `./gradlew`, Windows는 `./gradlew.bat`만 지원한다. `args`에는 `test`가
정확히 한 번 있어야 하며 선택된 모듈 태스크들로 교체한다. Windows 변형이 있으면 실행 파일과
인자 모두 해당 변형을 사용한다. 다른 도구의 명령도 저장할 수 있는 설정 계약과, 이 Gradle
실행기가 실제로 지원하는 명령 범위는 구분한다.

허용 옵션은 `--console=plain`, `--no-daemon`, `--offline`, `--rerun-tasks`, `--stacktrace`,
`--info`, `--warn`, `--refresh-dependencies`, `--warning-mode=all|summary|none|fail`이다.
다른 태스크, `--tests`, `-P`, init script, 프로젝트 디렉터리 변경과 임의 옵션은 중단한다.
실행 결과 판독과 중단 시 정리를 위해 `--console=plain`, `--no-daemon`을 추가한다.
`--rerun-tasks`는 사용자가 설정했을 때만 적용하며 캐시 정책을 임의로 바꾸지 않는다.

## 선택 규칙

Git의 NUL 구분 출력으로 merge-base부터 HEAD까지의 변경에 staged, unstaged와 untracked를
합친다. rename은 이전 경로와 새 경로 모두를 분석한다.

1. 현재와 기준 버전의 모듈 구성 또는 settings가 달라지면 현재 유효한 전체 `test`를 선택한다.
2. 설정한 공통 모듈, 전체 영향 경로 또는 루트 빌드 설정, Wrapper, `gradle/`, `buildSrc/`,
   `build-logic/` 변경은 전체 테스트로 확대한다. `common`이라는 이름을 고정하지 않는다.
3. 일반 모듈 변경은 `:module:test`를 선택한다. 여러 모듈은 한 프로세스에서 함께 실행한다.
4. 명시된 문서 경로만 바뀌면 이유를 남기고 생략한다. 전체 영향과 모듈 판정이 문서보다 우선한다.
5. 미분류 변경은 해당 경로를 보여주며 전체 테스트로 확대한다. 빈 변경은 별도 이유로 생략한다.

CLI 전용 `artifactsDir`의 untracked 파일과 정확한 Gradle 산출물 디렉터리 `.gradle/`,
루트 `build/`, 현재 모듈의 `build/`는 선택과 코드 지문에서 제외한다. 같은 위치의 추적 파일은
소스로 취급한다. `artifactsDir`에 추적 파일이 있거나 모듈/빌드 경로와 겹치면 실행하지 않는다.
이 경로들에 사용자 소스를 두지 말고, 설치된 `.gitignore`도 유지한다.

## Windows와 명령 경계

Unix에서는 Wrapper와 argv를 분리해 shell 없이 실행한다. Windows 배치 파일은
`SystemRoot/System32/cmd.exe /d /s /v:off /c` 경계를 사용하며 검증된 Wrapper 경로와 허용된 인자만 인용한다.
상속된 `ComSpec`으로 다른 인터프리터를 실행하지 않는다.
공백과 한글 경로를 지원한다. Windows 경로/인자의 `" % ! ^ & | < > ( )`, 줄바꿈과 NUL은
해석이 바뀔 수 있어 실행 전 거부한다. 해당 문자가 없는 경로에서 실행해야 한다.
지원하지 않는 값을 임의 escaping하거나 eval로 실행하지 않는다.

Ctrl+C/SIGTERM은 취소 요청으로 처리한다. Windows는 자식 PID의 `taskkill /T /F`,
Unix는 분리된 프로세스 그룹의 종료와 필요시 강제 종료를 사용한다. 정리 실패는 기록한다.
Wrapper와 빌드 스크립트는 대상 프로젝트의 실행 코드이며 샌드박스가 아니다. 별도로 분리된
프로세스, 외부 서비스나 강제 CLI 종료까지 완전하게 정리한다고 보장하지 않는다.

## 상태와 종료 코드

| 상태 | 의미 | CLI 종료 코드 |
| --- | --- | --- |
| `not-run` | dry-run 또는 입력/분석/프로세스 시작 오류 | preview 0, 오류 2 |
| `running` | 시작 기록은 있지만 종료 기록이 아직 없음 | 저장 중인 상태 |
| `succeeded` | 실제 프로세스 종료 0, 확인된 XML 실패 없음 | 0 |
| `failed` | 프로세스 비0 또는 이번 XML에 실패, 실행 후 기록 오류 | 테스트 실패 1, I/O 오류 2 |
| `interrupted` | 취소/signal 또는 종료 기록이 없는 실행 | 130 |
| `skipped` | 빈 변경 또는 명시된 문서 변경 | 0 |

원래 프로세스 종료 코드와 signal은 `execution`에 그대로 보존한다. `succeeded`는 build
프로세스 성공이며 모든 테스트를 새로 실행했다는 의미가 아니다. `UP-TO-DATE`, `FROM-CACHE`,
`NO-SOURCE`, `SKIPPED`, 새 XML 없음과 테스트 0개를 구별한다. 호출 전 로그는 증거로 쓰지 않는다.

XML은 실행 전후의 목록, SHA-256, 크기와 수정 시각을 비교한다. 새로 생기거나 바뀐 파일이며
해당 test 태스크가 실제 실행된 경우에만 지원하는 Gradle JUnit XML의 수치를 집계한다.
캐시로 복원된 XML, 이전 XML, task 실행 근거 없는 XML, 읽을 수 없는 형식은 통과 수에 넣지 않는다.
기본 위치를 변경한 프로젝트에서는 확인된 프로세스 상태와 테스트 수 미확인만 보고한다.
XML은 파일당 4 MiB, 전체 32 MiB, 1000개까지 지원하며 한도를 넘으면 명시적으로 오류를 낸다.

## 기록과 이후 코드 변경

실제 실행이나 생략마다 `<artifactsDir>/runs/<UUID>/record.json`을 만든다. `schemaVersion: 1`의
`TestResult` 타입은 [src/test.ts](../src/test.ts)에 정의되어 있고 다음을 포함한다.

- run ID, 시작/종료 시각, Git 루트와 전용 산출물 디렉터리, 설정 경로, 비교 ref/commit/merge-base
- 분석 상태, 변경 경로, 선택 모듈/태스크/이유, 실제 실행 파일과 argv
- 실행 전후 HEAD, index, 작업 트리/관련 untracked 내용과 설정의 SHA-256 지문
- 실제 프로세스 종료 코드/signal/오류, task 결과, 이번 실행 XML 수치와 증거 복사본 위치
- stdout/stderr의 경로, 전체 수신 바이트 수와 잘림 여부, 경고/오류

어느 실행된 suite의 XML을 읽지 못하면 합계는 `null`이다. 다른 정상 XML에서 이미 확인한
실패는 `evidence.hasFailures`로 유지하므로 부분 집계 오류가 기존 실패를 숨기지 않는다.
기록을 읽을 때에는 필드 형식, 상태/종료 코드의 일치와 증거 경로 이탈도 검사한다.
기록 위치는 저장된 Git 루트와 `artifactsDir` 아래의 `runs/<runId>/record.json`이어야 한다.

stdout/stderr는 각각 앞 1 MiB만 저장하고 이후 출력도 drain한다. 환경변수 전체는 기록하지
않는다. 로그에는 프로젝트가 출력한 민감한 값이 있을 수 있으므로 원문을 PR에 자동 복사하지
않는다. 기록은 자동 삭제하지 않는다. 필요 없는 오래된 run 디렉터리는 사용자가 정리한다.
새 run과 증거 디렉터리는 Unix에서 0700, 기록/로그/XML 파일은 0600 권한으로 만든다.
Windows에서는 실행 계정과 부모 디렉터리의 ACL을 따른다.

V1은 테스트 수와 원본 XML 복사본을 보존한다. 실패 테스트 이름의 구조화는 후속 `report`가
보존된 이번 실행 증거에서 수행하며 원문 로그나 예전 XML에서 추측하지 않는다.

시작 기록을 먼저 쓰고 종료 후 파일을 교체한다. 강제 종료로 `running`만 남았으면 `readTestRun`
조회에서 필수 필드가 갖춰진 시작 기록인지 검사한 뒤 미완료 중단으로 식별하며 성공으로 복구하지 않는다.
종료 상태인데 종료 시각이 없거나 필수 필드가 유실된 기록은 잘못된 기록으로 거부한다. 쓰기 실패와 부분 기록은 오류로
보고한다. 실패 원인을 고친 뒤 같은 명령을 다시 실행하면 새 run이 생기며 과거 실행을 덮어쓰지 않는다.

`codeState`는 실행 전후 지문 비교다. 달라졌거나 비교할 수 없으면 현재 코드가 검증됐다고
표시하지 않는다. 실행 중 일시적으로 바뀌었다가 원복된 모든 순간까지 관찰하는 감시 기능은 아니다.
라이브러리의 `checkTestRunFreshness(readTestRun(recordPath))`는 현재 코드, 설정과 비교 ref를
다시 확인해 `current`, `changed`, `unknown`, `incomplete`를 반환한다. 이후 `report`는 이 계약을
사용한다. 이번 이슈에서는 `report` 명령과 GitHub 게시를 구현하지 않는다.

## 검증 경계

`npm run check`의 핵심 검증은 외부 서비스와 실제 Gradle 없이 임시 Git 저장소와 실행 stub을
사용한다. 선택 규칙, 변경 종류, 결과 파일 신선도, 실제 프로세스 성공/실패/취소, 인자 경계,
지문 변경과 dry-run 무변경을 검사한다.

실제 Gradle 검증은 격리한 최소 프로젝트에서 JDK와 Wrapper 버전, 캐시 여부를 기록해 별도로
수행한다. TicketRush 원본에는 읽기 전용 dry-run만 적용한다. 원본의 DB/Redis/Kafka 의존 테스트를
실행하거나 파일을 생성하지 않는다. 다른 환경에서 검증을 재현할 때도 같은 경계를 유지한다.

2026-11-09 Windows / Node.js 22.17.0 / Java 21.0.6 / Gradle 9.3.0에서 공백과 한글이 있는
격리된 두 모듈 프로젝트를 검증했다. 이미 설치된 Wrapper와 의존성 캐시를 사용하고
`--offline`, `--no-daemon`으로 실행했다.

- dry-run 전후 `.git`을 포함한 파일 내용 불변
- 단일 모듈: 실제 테스트 1개, 실패 0개와 프로세스 종료 0
- 재실행: `UP-TO-DATE`, 새 XML 집계 없음
- 루트 빌드 변경: 전체 선택, 기존 모듈은 `UP-TO-DATE`, 다른 모듈의 새 테스트 1개만 집계
- 실패 assertion: 프로세스 종료 1, 이번 실행 XML의 실패 1개
- 실행 중 취소: `interrupted`, CLI 코드 130, 프로세스 정리 오류 없음
- TicketRush 원본: 정적 모듈 9개 분석, HEAD 기준 변경 없음으로 dry-run 생략,
  실행 기록 없음과 코드 지문/Git 상태/index/config 불변 확인

실제 Ubuntu Gradle 실행과 TicketRush의 외부 서비스 의존 테스트는 이 로컬 검증에서 실행하지 않았다.
별도로 WSL Ubuntu / Node.js 22.23.2에서 변경 선택, Git 상태, stub 실행과 기록 테스트를
실행했다. Windows에서 생략한 비 UTF-8 파일명, SIGTERM을 무시하는 자식의 강제 종료와
Unix 파일 권한 검증도 이 환경에서 확인했다. GitHub Actions 결과와는 구분한다.

실행 경계의 근거: [Node.js 22 child_process](https://nodejs.org/download/release/v22.17.0/docs/api/child_process.html),
[Microsoft cmd](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd),
[Gradle task 결과](https://docs.gradle.org/current/userguide/gradle_optimizations.html),
[Gradle JUnit XML](https://docs.gradle.org/current/userguide/java_testing.html).
