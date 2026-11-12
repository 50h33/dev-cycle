# 변경 모듈 테스트와 실행 기록

`dev-cycle test`는 변경된 Gradle 모듈을 고르고 Wrapper를 실행한 뒤 실제 결과를 기록합니다.
특정 브랜치명이나 공통 모듈명을 가정하지 않으며, 모듈 밖의 변경도 설정에 따라 판단합니다.
코드 작성과 리뷰 판단은 Claude Code가 담당하고, CLI는 Git과 설정을 읽어 프로세스를
실행합니다.

## 사용

먼저 dev-cycle 소스 저장소에서 `npm ci`와 `npm run build`를 실행하세요.
아래 CLI 경로는 실제로 빌드한 위치로 바꾸세요. 설정과 기준 커밋부터 준비하는 예시는
[시작 가이드](quickstart.md)에서 확인할 수 있습니다.

```sh
node /path/to/dev-cycle/dist/cli.js test /path/to/project --dry-run --json
node /path/to/dev-cycle/dist/cli.js test /path/to/project
node /path/to/dev-cycle/dist/cli.js test /path/to/project --base-ref origin/trunk --config /path/to/config.json --json
```

대상 경로를 생략하면 현재 디렉터리에서 Git 루트를 찾습니다. `--config`의 상대 경로는 명령을
호출한 디렉터리를 기준으로 해석합니다. 이 옵션을 생략하면 대상 Git 루트의
`dev-cycle.config.json`을 사용합니다. `--base-ref`가 설정의 `baseRef`보다 우선하며,
`baseRef`가 없으면 `defaultBranch`를 사용합니다. 기준 ref와 HEAD의 commit, merge-base를
확인하다가 ref 오류가 나거나 저장소에 커밋이 없으면 중단합니다. 자동 fetch, 브랜치 추정,
Git 설정 변경은 하지 않습니다.

`--dry-run`은 선택 결과와 실행할 명령만 반환합니다. Wrapper를 실행하지 않고 로그, 기록,
캐시도 만들지 않습니다. 정상 preview의 상태는 `not-run`이고 종료 코드는 0입니다. JSON
형식에서는 stdout에 객체 하나만 출력합니다. 실제 실행의 원문 stdout/stderr는 크기를 제한한
로컬 파일에 저장합니다.

## 지원하는 프로젝트

- Node.js 22.17 이상 22 계열, Git, Windows 또는 Ubuntu, 프로젝트의 JDK와 Gradle Wrapper.
- 루트의 Groovy `settings.gradle`에 선언한 정적 최상위 모듈. 설정 파일 자체를 실행하지 않습니다.
- `rootProject.name = 'name'`, `include 'api'`, `include 'api', 'shared'`,
  `include('api', 'shared')`, 괄호 안 여러 줄, 주석과 공백.
- `projectDir`, `includeBuild`, 중첩 모듈, Kotlin DSL, 동적 Groovy, plugins 블록 등
  지원 문법 밖의 설정은 일부만 분석하지 않고 중단 이유를 표시합니다.
- Git 충돌, submodule, 소스의 symlink/junction을 발견하면 중단합니다.
- partial clone/promisor 저장소는 누락된 객체를 읽을 때 자동으로 다운로드할 수 있으므로 분석 전에
  거부합니다. 원격 객체를 모두 가지고 있는 일반 로컬 복사본을 사용하세요.
- 최상위 모듈 이름 `build`는 루트 Gradle 산출물 경로와 겹치므로 지원하지 않습니다.
  모듈명과 산출물 경로의 대소문자는 실제 디렉터리 이름과 같아야 합니다.
- 표준 `test` 태스크와 기본 `build/test-results/test/*.xml` 위치를 사용합니다.
  임의의 의존 그래프, 사용자 정의 테스트 태스크, XML 위치는 추정하지 않습니다.

설정 형식은 [워크플로 설정과 배포](workflow-package.md)를 따릅니다. 이 어댑터는
`commands.test`의 실행 파일로 `./gradlew`만 지원하며, Windows에서는 `./gradlew.bat`만
지원합니다. `args`에는 `test`가 정확히 한 번 있어야 합니다. 실행할 때 이 값을 선택된 모듈의
테스트 태스크로 바꿉니다. Windows용 설정이 있으면 실행 파일과 인자를 모두 Windows 값으로
바꾸며, 두 설정을 합치지 않습니다. 설정 파일에는 다른 도구의 명령도 저장할 수 있지만,
이 Gradle 실행기가 실제로 허용하는 명령은 더 제한적입니다.

허용하는 옵션은 `--console=plain`, `--no-daemon`, `--offline`, `--rerun-tasks`, `--stacktrace`,
`--info`, `--warn`, `--refresh-dependencies`, `--warning-mode=all|summary|none|fail`입니다.
다른 태스크, `--tests`, `-P`, init script, 프로젝트 디렉터리 변경, 임의 옵션을 발견하면
중단합니다. 실행 결과를 안정적으로 읽고 중단 시 프로세스를 정리하기 위해
`--console=plain`과 `--no-daemon`을 추가합니다. `--rerun-tasks`는 사용자가 설정했을 때만
적용하며 캐시 정책을 임의로 바꾸지 않습니다.

## 선택 규칙

Git의 NUL 구분 출력을 사용해 merge-base부터 HEAD까지의 변경과 staged, unstaged, untracked
변경을 합칩니다. rename은 이전 경로와 새 경로를 모두 분석합니다.

1. 현재와 기준 버전의 모듈 구성 또는 settings가 다르면 현재 유효한 전체 `test`를 선택합니다.
2. 설정한 공통 모듈, 전체 영향 경로 또는 루트 빌드 설정, Wrapper, `gradle/`, `buildSrc/`,
   `build-logic/`가 바뀌면 전체 테스트로 확대합니다. `common`이라는 이름을 고정해 사용하지 않습니다.
3. 일반 모듈이 바뀌면 `:module:test`를 선택합니다. 여러 모듈은 한 프로세스에서 함께 실행합니다.
4. 설정에 적힌 문서 경로만 바뀌면 이유를 남기고 테스트를 생략합니다. 전체 영향 경로나 모듈
   변경으로도 판단할 수 있는 경로라면 해당 판정을 문서 변경보다 먼저 적용합니다.
5. 어느 규칙에도 맞지 않는 변경은 경로를 보여주고 전체 테스트로 확대합니다. 변경이 없으면
   별도 이유를 남기고 생략합니다.

CLI 전용 `artifactsDir`의 untracked 파일과 정확한 Gradle 산출물 디렉터리 `.gradle/`, 루트
`build/`, 현재 모듈의 `build/`는 모듈 선택과 코드 지문에서 제외합니다. 코드 지문은 테스트
당시 파일 상태를 나중에 비교하기 위해 만든 SHA-256 해시입니다. 같은 위치에 Git이 추적하는
파일이 있으면 소스로 처리합니다. `artifactsDir`에 추적 파일이 있거나 이 경로가 모듈/빌드
경로와 겹치면 실행하지 않습니다. 이 경로에는 사용자 소스를 두지 말고, 설치된 `.gitignore`도
유지하세요.

## Windows에서 실행할 때

Unix에서는 Wrapper와 argv를 분리해 shell 없이 실행합니다. Windows 배치 파일은
`SystemRoot/System32/cmd.exe /d /s /v:off /c`를 통해 실행하며, 검증한 Wrapper 경로와
허용된 인자만 인용합니다. 상속된 `ComSpec`을 사용해 다른 인터프리터를 실행하지 않습니다.
공백과 한글이 있는 경로는 지원합니다. 다만 Windows 경로나 인자에 `" % ! ^ & | < > ( )`,
줄바꿈, NUL이 있으면 명령 해석이 달라질 수 있어 실행 전에 거부합니다. 해당 문자가 없는
경로에서 실행하세요. 지원하지 않는 값을 임의로 escaping하거나 eval로 실행하지 않습니다.

Ctrl+C/SIGTERM은 취소 요청으로 처리합니다. Windows에서는 자식 PID에 `taskkill /T /F`를
실행하고, Unix에서는 분리된 프로세스 그룹을 종료한 뒤 필요하면 강제로 종료합니다. 정리에
실패하면 그 사실을 기록합니다. Wrapper와 빌드 스크립트는 대상 프로젝트의 코드를 직접
실행하며 샌드박스 안에서 실행하지 않습니다. 별도로 분리된 프로세스나 외부 서비스,
CLI를 강제로 종료한 경우까지 모두 정리한다고 보장하지 않습니다.

## 상태와 종료 코드

| 상태 | 의미 | CLI 종료 코드 |
| --- | --- | --- |
| `not-run` | dry-run 또는 입력/분석/프로세스 시작 오류 | preview 0, 오류 2 |
| `running` | 시작 기록은 있지만 종료 기록이 아직 없음 | 저장 중인 상태 |
| `succeeded` | 실제 프로세스 종료 0, 확인된 XML 실패 없음 | 0 |
| `failed` | 프로세스 비0 또는 이번 XML에 실패, 실행 후 기록 오류 | 테스트 실패 1, I/O 오류 2 |
| `interrupted` | 취소/signal 또는 종료 기록이 없는 실행 | 130 |
| `skipped` | 빈 변경 또는 명시된 문서 변경 | 0 |

원래 프로세스 종료 코드와 signal은 `execution`에 그대로 저장합니다. `succeeded`는 build
프로세스가 성공했다는 뜻이며, 모든 테스트를 새로 실행했다는 뜻은 아닙니다. `UP-TO-DATE`,
`FROM-CACHE`, `NO-SOURCE`, `SKIPPED`, 새 XML 없음, 테스트 0개를 각각 구분합니다. CLI를
호출하기 전에 만들어진 로그는 이번 결과를 판단하는 데 사용하지 않습니다.

XML은 실행 전후의 파일 목록, SHA-256, 크기, 수정 시각을 비교합니다. 새로 생기거나 바뀐
파일이면서 해당 test 태스크가 실제로 실행된 경우에만 지원하는 Gradle JUnit XML의 수치를
집계합니다. 캐시에서 복원된 XML, 이전 XML, task 실행 기록이 없는 XML, 읽을 수 없는 형식은
통과 수에 넣지 않습니다. 기본 위치를 바꾼 프로젝트에서는 확인된 프로세스 상태만 보여주고
테스트 수는 확인하지 못했다고 표시합니다. XML은 파일당 4 MiB, 전체 32 MiB, 1000개까지
지원하며 한도를 넘으면 오류를 냅니다.

## 기록과 이후 코드 변경

실제로 실행하거나 생략할 때마다 `<artifactsDir>/runs/<UUID>/record.json`을 만듭니다.
`schemaVersion: 1`의 `TestResult` 타입은 [src/test.ts](../src/test.ts)에 정의되어 있으며
다음 정보를 포함합니다.

- run ID, 시작/종료 시각, Git 루트와 전용 산출물 디렉터리, 설정 경로, 비교 ref/commit/merge-base
- 분석 상태, 변경 경로, 선택 모듈/태스크/이유, 실제 실행 파일과 argv
- 실행 전후 HEAD, index, 작업 트리/관련 untracked 내용과 설정의 SHA-256 지문
- 실제 프로세스 종료 코드/signal/오류, task 결과, 이번 실행 XML 수치와 증거 복사본 위치
- stdout/stderr의 경로, 전체 수신 바이트 수와 잘림 여부, 경고/오류

실행된 suite 중 하나라도 XML을 읽지 못하면 합계를 `null`로 둡니다. 다른 정상 XML에서 이미
실패를 확인했다면 `evidence.hasFailures`에 남기므로 일부 XML 집계 오류가 기존 실패를 숨기지
않습니다. 기록을 읽을 때는 필드 형식, 상태와 종료 코드의 일치 여부, 결과 파일 경로가 허용
범위를 벗어나는지도 검사합니다. 기록은 저장된 Git 루트와 `artifactsDir` 아래의
`runs/<runId>/record.json`에 있어야 합니다.

stdout/stderr는 각각 앞 1 MiB만 저장하고 이후 출력도 계속 읽어 프로세스가 막히지 않게 합니다.
환경변수 전체는 기록하지 않습니다. 로그에는 프로젝트가 출력한 민감한 값이 들어 있을 수
있으므로 원문을 PR에 자동으로 복사하지 않습니다. 기록은 자동 삭제하지 않으니 필요 없는 오래된
run 디렉터리는 사용자가 정리하세요. 새 run과 결과 디렉터리는 Unix에서 0700, 기록/로그/XML
파일은 0600 권한으로 만듭니다. Windows에서는 실행 계정과 부모 디렉터리의 ACL을 따릅니다.

V1은 테스트 수와 원본 XML 복사본을 보존하지만 실패한 테스트 이름을 구조화해 기록하지
않습니다. `report`는 저장된 합계만 사용하며 원문 로그, 복사한 XML, 예전 XML에서 이름을
추정하지 않습니다.

시작 기록을 먼저 쓰고 프로세스가 끝나면 종료 기록으로 파일을 교체합니다. 강제 종료로
`running` 상태만 남았다면 `readTestRun`이 필수 필드를 갖춘 시작 기록인지 검사합니다. 유효한
시작 기록은 미완료 중단으로 표시하고 성공으로 바꾸지 않습니다. 종료 상태인데 종료 시각이
없거나 필수 필드가 빠진 기록은 잘못된 기록으로 거부합니다. 쓰기 실패와 부분 기록도 오류로
보고합니다. 원인을 해결한 뒤 같은 명령을 다시 실행하면 새 run을 만들며 이전 기록을
덮어쓰지 않습니다.

`codeState`는 실행 전과 실행 후의 코드 지문을 비교한 결과입니다. 두 지문이 다르거나 비교할
수 없으면 현재 코드가 검증됐다고 표시하지 않습니다. 다만 실행 중 잠깐 바뀌었다가 원래대로
돌아온 모든 순간을 감시하는 기능은 아닙니다.

라이브러리의 `checkTestRunFreshness(readTestRun(recordPath))`는 현재 코드, 설정, 비교 ref를
다시 확인해 `current`, `changed`, `unknown`, `incomplete` 중 하나를 반환합니다. 여기서
신선도(freshness)는 테스트 당시 코드와 현재 코드가 같은지를 뜻합니다. `report`는 이 결과와
현재 지정한 설정을 사용해 기록의 신선도를 표시합니다. report의 선택과 출력 규칙은
[report 사용법](report.md)을 따릅니다. CLI는 GitHub에 게시하지 않습니다.

## 검증 범위

`npm run check`의 핵심 검증은 외부 서비스나 실제 Gradle을 사용하지 않고 임시 Git 저장소와
실행 stub으로 진행합니다. 선택 규칙, 변경 종류, 결과 파일 신선도, 실제 프로세스의
성공/실패/취소, 허용 인자, 지문 변경, dry-run 전후 파일 불변을 검사합니다.

실제 Gradle 검증은 격리한 최소 프로젝트에서 별도로 수행하며 JDK와 Wrapper 버전, 캐시 사용
여부를 기록합니다. 실제 프로젝트에서 검증을 재현할 때는 외부 서비스 의존성과 파일 생성
범위를 먼저 확인하세요.

2026-11-09 Windows / Node.js 22.17.0 / Java 21.0.6 / Gradle 9.3.0에서 공백과 한글이 있는
격리된 두 모듈 프로젝트를 검증했습니다. 이미 설치된 Wrapper와 의존성 캐시를 사용하고
`--offline`, `--no-daemon`으로 실행했습니다.

- dry-run 전후 `.git`을 포함한 파일 내용 불변
- 단일 모듈: 실제 테스트 1개, 실패 0개와 프로세스 종료 0
- 재실행: `UP-TO-DATE`, 새 XML 집계 없음
- 루트 빌드 변경: 전체 선택, 기존 모듈은 `UP-TO-DATE`, 다른 모듈의 새 테스트 1개만 집계
- 실패 assertion: 프로세스 종료 1, 이번 실행 XML의 실패 1개
- 실행 중 취소: `interrupted`, CLI 코드 130, 프로세스 정리 오류 없음

실제 Ubuntu Gradle 실행은 이 로컬 검증에서 실행하지 않았습니다.
별도로 WSL Ubuntu / Node.js 22.23.2에서 변경 선택, Git 상태, stub 실행과 기록 테스트를
실행했습니다. Windows에서 생략한 비 UTF-8 파일명, SIGTERM을 무시하는 자식 프로세스의 강제
종료, Unix 파일 권한도 이 환경에서 확인했습니다. GitHub Actions 결과와는 구분합니다.

실행 경계의 근거: [Node.js 22 child_process](https://nodejs.org/download/release/v22.17.0/docs/api/child_process.html),
[Microsoft cmd](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd),
[Gradle task 결과](https://docs.gradle.org/current/userguide/gradle_optimizations.html),
[Gradle JUnit XML](https://docs.gradle.org/current/userguide/java_testing.html).
