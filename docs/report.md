# 실행 기록 기반 report

`dev-cycle report`는 `test`가 저장한 실제 실행 기록을 읽고, PR 본문에 붙일 Markdown 블록을
만듭니다. GitHub에 게시하거나 commit, push, merge를 수행하지 않습니다. 실행 기록에 없는
결과를 만들거나 사람의 판단을 대신하지도 않습니다.

## 사용

먼저 dev-cycle 소스 저장소에서 `npm ci`와 `npm run build`를 실행하세요.
아래 CLI 경로는 실제로 빌드한 위치로 바꾸세요.

```sh
node /path/to/dev-cycle/dist/cli.js report /path/to/project
node /path/to/dev-cycle/dist/cli.js report /path/to/project --json
node /path/to/dev-cycle/dist/cli.js report /path/to/project --run-id 01234567-89ab-cdef-0123-456789abcdef
node /path/to/dev-cycle/dist/cli.js report /path/to/project --output .dev-cycle/reports/pr-tests.md
node /path/to/dev-cycle/dist/cli.js report /path/to/project --output .dev-cycle/reports/pr-tests.md --dry-run
node /path/to/dev-cycle/dist/cli.js report /path/to/project --config /path/to/config.json
```

대상 경로를 생략하면 현재 디렉터리에서 Git 루트를 찾습니다. `--config`의 상대 경로는 명령을
호출한 디렉터리를 기준으로 해석합니다. 이 옵션을 생략하면 대상 Git 루트의
`dev-cycle.config.json`을 사용합니다.

기본 출력은 stdout으로 보내는 Markdown입니다. `--json`을 사용하면 Markdown, 선택한
`TestResult` 기록, 신선도, 진단을 JSON 객체 하나로 stdout에 출력합니다. `--json`을 함께
사용해도 `--output` 파일에는 항상 Markdown을 씁니다. stdout 출력만 요청하면 저장소를
변경하지 않습니다.

## 기록 선택

`--run-id`를 지정하지 않으면 `<artifactsDir>/runs/`에서 시작 시각이 가장 최근인 기록을
선택합니다. 시작 시각이 같으면 UUID 문자열의 내림차순으로 결정합니다. 가장 최근 기록이
실패, 중단, 생략, 미실행 상태여도 그대로 사용하며 과거의 성공 기록으로 바꾸지 않습니다.

run 디렉터리의 UUID가 잘못됐거나 `record.json`이 없거나 손상됐거나 지원하지 않는 버전이면,
기본 선택을 중단하고 해당 기록의 문제를 보여줍니다. 잘못된 최신 기록을 건너뛰고 과거 성공
기록을 보여주지는 않습니다. `--run-id`에는 올바른 UUID 하나를 정확히 지정해야 하며, report는
해당 기록만 읽습니다. 과거 실행을 직접 지정하면 현재 코드 상태와 다시 비교하고 과거 기록을
선택했다는 경고를 표시합니다.

실행 기록이 하나도 없으면 상태를 `not-run`으로 둡니다. 저장된 기록이 없어 현재 코드의 테스트
여부와 결과를 확인할 수 없다고 출력하며 성공으로 바꾸지 않습니다. dry-run은 기록을 만들지
않으므로 dry-run만 실행한 경우에도 같은 결과가 나옵니다. 잘못된 기록, 존재하지 않는 명시적
run ID, 다른 저장소에서 만든 기록은 종료 코드 2인 오류입니다.

## 보고하는 내용

Markdown에는 실행 기록에 있는 다음 정보만 포함합니다.

- run ID, 시작과 종료 시각, 비교 ref와 당시 commit
- 선택 모드, 모듈, 태스크, 변경 경로와 선택 이유
- 실행 파일과 argv, 실제 프로세스 종료 코드와 signal
- 성공, 실패, 중단, 생략, 미실행 상태와 기록된 오류/경고
- 이번 실행의 신뢰 가능한 XML 합계와 task 결과
- 실행 전후 코드 상태 및 현재 코드/설정과 기록의 신선도

프로세스가 종료 코드 0으로 끝난 것과 새 테스트를 실행한 것은 서로 다른 정보입니다.
`UP-TO-DATE`, `FROM-CACHE`, `NO-SOURCE`, `SKIPPED`, 테스트 0개, 새 XML 없음은 새 테스트가
통과한 수로 표시하지 않습니다. V1 기록에는 실패한 테스트 이름과 커버리지가 없으므로 XML이나
로그를 다시 해석해 채우지 않습니다. 원문 stdout/stderr, 구현 의도, 성과, 수동 시연,
스크린샷, 원격 CI 결과도 자동으로 복사하거나 추정하지 않습니다.

## 테스트 이후 코드 변경 확인

report는 테스트 당시와 현재 코드가 같은지 확인합니다. 이를 위해 실행 전후에 만든 코드 지문과
현재 HEAD, index, tracked/untracked 파일 내용, 설정, 비교 ref를 대조합니다. 코드 지문은 파일
상태를 변경 비교용 SHA-256 해시로 기록한 값입니다. 이 비교 결과를 다음 상태로 나눕니다.

| 상태 | 의미 |
| --- | --- |
| `current` | 기록 종료 시점과 현재 코드/설정 및 비교 기준이 같다 |
| `changed` | 실행 중 또는 실행 이후 코드, 설정이나 비교 기준이 바뀌었다 |
| `unknown` | 필요한 상태를 읽거나 비교할 수 없다 |
| `incomplete` | 종료 기록이 없는 미완료 실행이다 |

이 비교 결과는 `freshness`이며, CLI 출력에는 ‘코드 신선도’로 표시됩니다.
`changed`, `unknown`, `incomplete`이면 현재 코드를 검증한 결과가 아니라고
Markdown에 표시합니다. 기록 자체의 성공 상태는 유지하지만 현재 코드의 검증 성공으로 바꾸지
않습니다. staged-only 변경, 삭제, rename, untracked 파일의 내용 변경도 코드 지문 비교 대상입니다.
CLI 관리 디렉터리에 기록과 report 파일만 추가됐다면 코드 변경으로 보지 않습니다.

파일 내용이 같아도 테스트 이후 `git add`로 index를 바꾸거나 커밋으로 HEAD를 바꾸면
`changed`가 될 수 있습니다. PR에 최종 커밋의 검증 결과를 넣으려면 커밋 후 테스트와 report를
다시 실행하세요. 비교 ref는 PR의 base 브랜치를 사용합니다. `HEAD`와 비교하면 커밋한 변경은
대상에서 빠지고, 미커밋 변경이 없으면 테스트가 생략됩니다. 재실행하지 못했다면 기존 결과를
과거 기록으로 구분하고 현재 코드 미검증 표시를 유지하세요.

## 파일 출력과 dry-run

`--output`에는 대상 Git 루트를 기준으로 한 상대 경로나 같은 저장소 안의 절대 경로를 지정할
수 있습니다. 출력 파일은 반드시 설정한 `<artifactsDir>/reports/` 아래에 있어야 합니다.
저장소 밖 경로, `..`로 범위를 벗어나는 경로, 링크/junction, Git이 추적 중인 파일이나 소스
경로와 충돌하는 위치는 거부합니다. 부모 디렉터리가 링크인지도 확인합니다. 기존 파일은
덮어쓰지 않습니다. 같은 이름으로 다시 만들려면 다른 이름을 지정하거나 기존 파일을 직접
정리하세요.

`--dry-run`은 선택한 기록, 신선도 비교 결과, Markdown, 출력 예정 경로를 반환하지만
디렉터리와 파일은 만들지 않습니다. 실제로 파일을 저장할 때는 저장 직전에 확인한 현재 코드
상태를 보고서 판단에 사용합니다. report 파일은 CLI 관리 경로에 있으므로 이후 `test`의 변경
모듈 선택과 코드 지문에 영향을 주지 않습니다. 신선도는 확인한 시점의 스냅샷입니다. 작업
트리를 잠그거나 이후 변경을 계속 감시하지는 않습니다.

## 상태와 종료 코드

| report 상태 | 의미 | 종료 코드 |
| --- | --- | --- |
| `generated` | 유효한 기록으로 Markdown을 만들었다 | 0 |
| `not-run` | 실행 기록이 없어 현재 검증 여부를 확인할 수 없는 Markdown을 만들었다 | 0 |
| `failed` | 기록, 설정, 경로 또는 파일 저장 오류 | 2 |

report의 종료 코드 0은 선택한 테스트가 통과했다는 뜻이 아닙니다. 테스트 상태와 종료 코드는
JSON의 `run.status`, `run.exitCode`와 Markdown에서 따로 확인하세요. 실패하거나 중단된 기록도
보고서를 정상적으로 만들면 report 자체의 상태는 `generated`이고 종료 코드는 0입니다.
현재 코드와 기록을 비교할 수 없으면 신선도는 `unknown`이 됩니다. report는 비교할 수 없는
이유를 포함한 `generated` 결과를 만들며, 이 상태를 현재 코드의 검증 성공으로 해석하면 안 됩니다.

## 전체 흐름과 실패 복구

[시작 가이드](quickstart.md)에서 기존 저장소에 설정을 준비하고, 테스트 결과를 보고서로
확인하는 순서를 안내합니다. 간단한 명령 순서는 [README](../README.md#시작하기)를 참고하세요.

init을 두 번째로 실행했을 때 설치 파일이 모두 유지되는지 확인하세요. test가 실패하거나
중단되면 report에서 상태를 확인하고 원인을 수정한 뒤 test를 다시 실행하세요. 새 실행은 새
run ID를 만들며 이전 기록을 덮어쓰지 않습니다. report도 다시 만들어 최신 결과와 현재 코드를
대조하세요.

핵심 자동 테스트는 임시 Git 저장소와 Node 실행 stub을 사용하므로 외부 서비스, GitHub 인증,
실제 Gradle 설치가 필요하지 않습니다. 실제 Gradle 결과는 격리된 최소 프로젝트에서
검증합니다.

Claude Code가 조사, 계획, 코드 작성, 리뷰 판단을 담당합니다. commit, push, PR 게시, 리뷰 답글,
merge는 대상 저장소의 지침과 사용자가 승인한 범위에서 별도로 수행합니다. `PreToolUse` 호출
기록이나 report 생성 성공만으로 테스트가 성공했다고 판단하지 않습니다.

## 실제 환경 검증 기록

2026-11-10 Windows / Node.js 22.17.0 / Java 21.0.6 / Gradle 9.3.0에서 공백과 한글 경로의
격리된 두 모듈 Git 저장소를 사용했습니다. 기존 의존성 캐시를 사용해
`--offline`, `--no-daemon`으로 실행했고 JUnit Jupiter 6.0.3의 실제 assertion 결과와
대조했습니다.

- 빈 저장소에서 init dry-run, 실제 설치, 동일 설정 재설치가 성공했습니다.
- init, test, report dry-run 전후에 `.git`을 포함한 파일 목록과 내용 해시가 같았습니다.
- test dry-run만 수행한 뒤 report가 `not-run`을 반환했습니다.
- 보고서는 모듈 테스트 1개, 실패 0개, 프로세스 종료 코드 0을 같은 run ID와 수치로 표시했습니다.
- 보고서를 관리 경로에 저장한 뒤에도 신선도는 `current`였습니다.
- 다시 실행했을 때 `UP-TO-DATE`인 결과는 새 테스트 수 `null`을 유지했습니다.
- assertion 실패 실행은 테스트 1개, 실패 1개, 비정상 종료를 최신 보고서에 그대로 표시했습니다.
- 테스트 후 코드를 수정하자 과거 기록의 신선도가 `changed`로 바뀌었습니다.
- 실행 중 취소는 `interrupted`로 보고됐으며 프로세스 정리 오류는 없었습니다.

실제 Ubuntu Gradle은 이 검증에서 실행하지 않았습니다.
핵심 자동 테스트의 Node stub 실행, 실제 Gradle 검증, 원격 CI 결과는 서로 구분해야 합니다.
