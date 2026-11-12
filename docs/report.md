# 실행 기록 기반 report

`dev-cycle report`는 `test`가 저장한 실제 실행 기록을 읽어 PR 본문에 붙일 Markdown 검증
블록을 만든다. GitHub에 게시하거나 커밋, push와 머지를 수행하지 않는다. 기록에 없는 결과와
사람의 판단은 만들지 않는다.

## 사용

먼저 dev-cycle 소스 저장소에서 `npm ci`와 `npm run build`를 실행한다.
아래 CLI 경로는 실제 빌드한 위치로 바꾼다.

```sh
node /path/to/dev-cycle/dist/cli.js report /path/to/project
node /path/to/dev-cycle/dist/cli.js report /path/to/project --json
node /path/to/dev-cycle/dist/cli.js report /path/to/project --run-id 01234567-89ab-cdef-0123-456789abcdef
node /path/to/dev-cycle/dist/cli.js report /path/to/project --output .dev-cycle/reports/pr-tests.md
node /path/to/dev-cycle/dist/cli.js report /path/to/project --output .dev-cycle/reports/pr-tests.md --dry-run
node /path/to/dev-cycle/dist/cli.js report /path/to/project --config /path/to/config.json
```

대상 경로를 생략하면 현재 디렉터리에서 Git 루트를 찾는다. `--config`는 명령을
호출한 디렉터리 기준이고, 생략하면 대상 Git 루트의 `dev-cycle.config.json`을 사용한다.

기본 출력은 stdout의 Markdown이다. `--json`을 사용하면 Markdown, 선택한 `TestResult` 기록,
신선도와 진단을 JSON 객체 하나로 stdout에 출력한다. `--json`은 `--output` 파일 형식을
바꾸지 않으며 파일에는 언제나 Markdown을 쓴다. stdout 출력만 요청하면 저장소를 변경하지 않는다.

## 기록 선택

`--run-id`가 없으면 `<artifactsDir>/runs/`에서 시작 시각이 가장 최근인 기록을 선택한다.
시작 시각이 같으면 UUID 문자열의 내림차순으로 결정한다. 가장 최근 기록이 실패, 중단, 생략 또는
미실행이어도 그대로 사용하며 과거 성공 기록으로 대체하지 않는다.

run 디렉터리의 UUID가 잘못됐거나 `record.json`이 없고, 손상됐거나 지원하지 않는 버전이면
기본 선택을 중단하고 해당 기록을 진단한다. 잘못된 최신 기록을 건너뛰어 과거 성공을 보여주지
않는다. `--run-id`는 올바른 UUID를 정확히 하나 지정하며 그 기록만 읽는다. 과거 실행을
명시하면 현재 코드 상태와 다시 비교하고 명시적 선택임을 경고한다.

실행 기록이 하나도 없으면 상태를 `not-run`으로 두고 저장된 실행 증거가 없어 현재 코드의
테스트 여부와 결과를 확인할 수 없다고 출력하며 성공으로 바꾸지 않는다. dry-run은 기록을
만들지 않으므로 dry-run만 확인된 경우에도 같은 결과다.
잘못된 기록, 존재하지 않는 명시적 run ID와 다른 저장소의 기록은 종료 코드 2인 오류다.

## 보고하는 내용

Markdown에는 기록에 있는 다음 사실만 포함한다.

- run ID, 시작과 종료 시각, 비교 ref와 당시 commit
- 선택 모드, 모듈, 태스크, 변경 경로와 선택 이유
- 실행 파일과 argv, 실제 프로세스 종료 코드와 signal
- 성공, 실패, 중단, 생략, 미실행 상태와 기록된 오류/경고
- 이번 실행의 신뢰 가능한 XML 합계와 task 결과
- 실행 전후 코드 상태 및 현재 코드/설정과 기록의 신선도

프로세스 종료 0과 새 테스트 실행은 별도 사실이다. `UP-TO-DATE`, `FROM-CACHE`,
`NO-SOURCE`, `SKIPPED`, 테스트 0개와 새 XML 없음은 새 테스트 통과 수로 표현하지 않는다.
V1 기록에 실패 테스트 이름과 커버리지가 없으므로 XML이나 로그를 다시 해석해 채우지 않는다.
원문 stdout/stderr, 구현 의도, 성과, 수동 시연, 스크린샷과 원격 CI 결과도 자동 복사하거나
추측하지 않는다.

## 신선도와 현재 코드

report는 기록의 실행 전후 지문과 현재 HEAD, index, tracked/untracked 내용, 설정 및 비교 ref를
대조한다. 다음 상태를 구분한다.

| 상태 | 의미 |
| --- | --- |
| `current` | 기록 종료 시점과 현재 코드/설정 및 비교 기준이 같다 |
| `changed` | 실행 중 또는 실행 이후 코드, 설정이나 비교 기준이 바뀌었다 |
| `unknown` | 필요한 상태를 읽거나 비교할 수 없다 |
| `incomplete` | 종료 기록이 없는 미완료 실행이다 |

`changed`, `unknown`, `incomplete`는 현재 코드를 검증한 결과가 아님을 Markdown에 명시한다.
기록 자체의 성공 상태는 보존하되 현재 검증으로 승격하지 않는다. staged-only 변경, 삭제,
rename과 untracked 파일 내용 변경도 지문 비교 대상이다. CLI 관리 디렉터리에 생성한 기록과
report만 추가된 경우에는 코드 변경으로 보지 않는다.

## 파일 출력과 dry-run

`--output`은 대상 Git 루트 기준 상대 경로나 같은 저장소 안의 절대 경로를 받는다. 출력 파일은
반드시 설정한 `<artifactsDir>/reports/` 아래여야 한다. 저장소 밖 경로, `..` 이탈, 링크/junction,
추적 중인 파일이나 소스 경로와의 충돌을 거부한다. 부모 디렉터리도 링크가 아닌지 확인한다.
기존 파일은 덮어쓰지 않으며 같은 이름을 다시 쓰려면 다른 이름을 지정하거나 기존 파일을
사용자가 명시적으로 정리해야 한다.

`--dry-run`은 기록 선택, 신선도 비교, Markdown과 출력 예정 경로를 반환하지만 디렉터리와
파일을 만들지 않는다. 파일을 저장하기 직전에 확인한 현재 코드 상태를 보고서 판단에 사용한다.
report 파일은 CLI 관리 경로에 있으므로 이후 `test`의 변경 모듈 선택과 코드 지문을 오염시키지 않는다.
신선도는 확인 시점의 스냅샷이며 작업 트리를 잠그거나 이후 변경을 계속 감시하는 기능은 아니다.

## 상태와 종료 코드

| report 상태 | 의미 | 종료 코드 |
| --- | --- | --- |
| `generated` | 유효한 기록으로 Markdown을 만들었다 | 0 |
| `not-run` | 실행 기록이 없어 현재 검증 여부를 확인할 수 없는 Markdown을 만들었다 | 0 |
| `failed` | 기록, 설정, 경로 또는 파일 저장 오류 | 2 |

report의 종료 코드 0은 선택한 테스트가 통과했다는 뜻이 아니다. 테스트 상태와 종료 코드는
JSON의 `run.status`, `run.exitCode`와 Markdown에서 별도로 확인한다. 실패 또는 중단 기록도
정확히 보고서를 만들면 report 자체는 `generated`와 종료 코드 0이다.
현재 코드와 기록을 비교할 수 없으면 신선도는 `unknown`이고 report는 확인 불가 이유를 포함한
`generated` 결과를 만든다. 이 상태를 현재 코드의 검증 성공으로 해석하지 않는다.

## 전체 흐름과 실패 복구

[최소 Gradle 따라 하기](quickstart.md)에서 설정·설치·실제 테스트·보고서와 변경 후 출력을
순서대로 재현할 수 있다. 간단한 명령 순서는 [README](../README.md#시작하기)를 참고한다.

두 번째 init 재실행에서 설치 파일이 모두 유지 상태인지 확인한다. test가 실패하거나 중단되면
report로 그 상태를 확인하고 원인을 수정한 뒤 test를 새로 실행한다. 새 실행은 새 run ID를 만들며
이전 기록을 덮어쓰지 않는다. report도 다시 생성해 최신 결과와 현재 코드를 대조한다.

핵심 자동 테스트는 임시 Git 저장소와 Node 실행 stub을 사용하므로 외부 서비스, GitHub 인증과
실제 Gradle 설치가 필요 없다. 실제 Gradle 결과 검증은 격리된 최소 프로젝트나 원본의 복사본에서
수행한다. TicketRush 원본에는 읽기 전용 dry-run만 적용하며 파일 생성이나 테스트 실행을 하지 않는다.

Claude Code가 조사, 계획, 코드 작성과 리뷰 판단을 담당한다. 커밋, push, PR 게시, 리뷰 답글과
머지는 대상 저장소 지침 및 사용자가 승인한 범위에서 별도로 수행한다. `PreToolUse` 호출 기록이나
report 생성 성공은 테스트 성공의 증거가 아니다.

## 실제 환경 검증 기록

2026-11-10 Windows / Node.js 22.17.0 / Java 21.0.6 / Gradle 9.3.0에서 공백과 한글 경로의
격리된 두 모듈 Git 저장소를 사용했다. TicketRush에서 Wrapper 파일만 복사했으며 원본에
설치, 테스트나 보고서 생성을 수행하지 않았다. 이미 있는 의존성 캐시와 `--offline`,
`--no-daemon`으로 실행했고, JUnit Jupiter 6.0.3의 실제 assertion 결과를 대조했다.

- 빈 저장소의 init dry-run, 실제 설치와 동일 설정 재설치가 성공했다.
- init, test와 report dry-run 전후 `.git`을 포함한 파일 목록/내용 해시가 같았다.
- test dry-run만 수행한 뒤 report는 `not-run`을 반환했다.
- 모듈 테스트 1개와 실패 0개, 프로세스 종료 0을 보고서가 같은 run ID와 수치로 표시했다.
- 보고서를 관리 경로에 저장한 뒤에도 신선도는 `current`였다.
- 재실행의 `UP-TO-DATE`는 새 테스트 수 `null`로 유지됐다.
- assertion 실패 실행의 테스트 1개, 실패 1개와 비정상 종료를 최신 보고서가 그대로 표시했다.
- 테스트 후 코드를 수정하자 과거 기록의 신선도가 `changed`로 바뀌었다.
- 실행 중 취소는 `interrupted`로 보고됐으며 프로세스 정리 오류는 없었다.

실제 Ubuntu Gradle과 TicketRush의 DB/Redis/Kafka 의존 테스트는 이 검증에서 실행하지 않았다.
핵심 자동 테스트의 Node stub 실행과 실제 Gradle 검증, 원격 CI 결과는 별도 증거다.
