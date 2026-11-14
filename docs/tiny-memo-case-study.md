# tiny-memo 적용 사례

[tiny-memo](https://github.com/50h33/tiny-memo)는 메모 한 개를 UTF-8 파일에 저장하고 다시 읽는
작은 웹 메모장입니다. 같은 작성자가 Codex로 기본 구성과 dev-cycle 설치를 마친 뒤 실제 메모
기능을 개발했습니다. 초기 설치만 확인하는 최소 fixture에서 한 단계 나아가, 기능 변경과
테스트를 dev-cycle CLI로 검증한 개인 프로젝트 한 건의 사례입니다.

2026-11-12에 설치와 개발을 시작했고 2026-11-15에 결과를 대조했습니다. 이 문서는 기존
개발 기록, tiny-memo의 원격 CI, dev-cycle 쪽에서 추가한 격리 검증을 구분합니다.
다른 사용자의 평가, 팀 도입, 지속 사용이나 시간 절감 효과는 측정하지 않았습니다.

작업 전에는 모듈 분리, `commonModules`, 설치와 개발 순서, CLI 경로와 실행 명령을 지정한
상세 프롬프트를 제공했습니다. 따라서 이 사례는 사전 안내를 받은 CLI 적용 결과이며,
작성자의 추가 설명 없이 사용 가이드만으로 도입할 수 있는지는 검증하지 않았습니다.

## 대상과 비교 기준

| 항목 | 확인한 값 |
| --- | --- |
| 기능 | 입력창과 저장 버튼, 파일 덮어쓰기, 새로고침과 서버 재시작 후 다시 읽기 |
| 모듈 | 저장 로직 `memo-core`, HTTP와 화면 `memo-web` |
| 빌드 | Groovy `settings.gradle`의 정적 최상위 모듈, 루트 Wrapper, 표준 `test`와 기본 XML 경로 |
| 최초 설치 커밋 | `ab69c016962019bf1b599671d154e99d951fe1b1` |
| 기능 구현과 검증 문서가 있는 커밋 | `e9b0e2ef6d1c15367537dd983bdad1815e650270` |
| 최초 적용에 사용한 dev-cycle | `f6e1e1232976c9bd6f8cda6dd09862fd18aa7a2b` |
| 추가 격리 검증에 사용한 dev-cycle | `9d797fc71f1d130a814f0c9d440e546aefb28a35` |
| 로컬 환경 | Windows 10.0.26300, Java 21.0.6, Gradle 9.3.0, Node.js 22.17.0, npm 10.9.2 |
| 수행자 | 저장소 작성자 50h33의 Codex 작업, dev-cycle 쪽 추가 검증도 Codex에서 수행 |
| 외부 조건 | DB나 외부 API 불필요. Wrapper와 Maven 의존성을 준비해야 하며 이번 로컬 실행은 기존 캐시를 사용 |

최초 커밋에는 Gradle 구성과 dev-cycle 설치물만 있고 기능 코드와 테스트는 없습니다.
이후 `feature/memo-save`에서 기능을 구현했습니다. 원본 dev-cycle 작업 트리는 보존하고 별도
복사본에서 CLI를 빌드했습니다. 순서와 환경은 tiny-memo의
[설치 기록](https://github.com/50h33/tiny-memo/blob/e9b0e2ef6d1c15367537dd983bdad1815e650270/docs/setup.md)과
[개발 및 검증 기록](https://github.com/50h33/tiny-memo/blob/e9b0e2ef6d1c15367537dd983bdad1815e650270/docs/verification.md)에 있습니다.

프로젝트 설정은 `repository: 50h33/tiny-memo`, `commonModules: ["memo-core"]`를 사용합니다.
`memo-web`이 core에 의존하므로 core 변경은 전체 테스트로 확대합니다. Windows 명령은
`./gradlew.bat`, 다른 환경은 `./gradlew`이며 인자는
`test --console=plain --no-daemon --rerun-tasks`입니다. `--rerun-tasks`는 새 테스트 실행을
확보하기 위해 명시했고 CLI가 임의로 캐시 정책을 바꾼 것은 아닙니다.

개발 당시 `baseRef: main`은 최초 설치 커밋을 가리켰습니다. 현재 `main`에는 기능이 포함돼
있으므로 같은 개발 구간을 재현할 때는 **최초 설치 커밋을 `--base-ref`로 지정**합니다.
현재 HEAD와 같은 ref를 비교하면 변경이 없어 테스트가 생략될 수 있으며, `--rerun-tasks`도
생략된 실행을 시작시키지는 않습니다. 일반 PR 검증에는 해당 PR의 base 브랜치를 사용하세요.

## 설치에서 확인한 동작

최초 도입에서는 `.gitignore` 충돌이 발생했습니다. 기존 규칙을 유지한 채 렌더링한 제외 블록을
파일 끝에 추가하는 [설치 안내](init.md#계획과-충돌)로 해결했습니다.

| 단계 | 실제 결과 |
| --- | --- |
| 최초 `init --dry-run` | `.gitignore` 충돌로 `blocked`, 종료 코드 1, 생성 0개 |
| 제외 블록을 추가한 뒤 dry-run | `ready`, 종료 코드 0 |
| 실제 설치 | `completed`, 18개 생성, 기존 `.gitignore` 1개 보존 |
| 같은 설정으로 재실행 | `completed`, 19개 모두 `unchanged` |

2026-11-15에는 tiny-memo의 로컬 Git 복사본을 새로 만들고 고정 커밋에서 추가 검증했습니다.
아래 변경은 검증을 위해 만든 것이며 원래 개발 변경과 구분합니다.

- 이미 설치된 상태의 dry-run에서 19개 모두 `unchanged`였습니다.
- `CLAUDE.md`, `.claude/settings.json`, `.gitignore`에 내용 차이를 만들고 배포 문서 하나를
  제거했습니다. dry-run과 실제 init 모두 충돌 3개로 `blocked`였고, 생성 가능한 문서도
  만들지 않았습니다. 각 실행 전후 `.git`을 포함한 파일 목록과 내용 해시가 같았습니다.
- 공유 파일을 원래 내용으로 돌리고 `.gitignore`의 사용자 규칙 뒤에 배포 블록을 유지하자
  `ready`가 됐습니다. 설치는 빠진 문서 1개만 만들었고 재실행은 19개 모두 보존했습니다.
- `CLAUDE.md`에 프로젝트 지침을 수동 병합하면 계속 충돌했습니다. 사용자 병합을 자동으로
  승인된 설치 상태로 처리하지 않는 현재 계약과 일치합니다.

## 실제 테스트, 코드 변경과 실패 표시

최초 기능 구현에서는 실제 파일과 HTTP 테스트를 작성했습니다. 최종 코드는 core 4개,
web 5개로 총 9개이며 실제 파일과 loopback HTTP를 사용합니다. 브라우저 동작 확인은 이
JUnit 개수에 포함하지 않습니다.

추가 격리 검증에서는 다음 순서로 실행했습니다. 비교 기준은 모두 최초 설치 커밋입니다.
`test --dry-run` 전후에도 `.git`을 포함한 파일 목록과 내용 해시가 같았습니다.

| 단계 | test 상태와 CLI / Gradle 종료 코드 | 이번 실행 XML | report 신선도 |
| --- | --- | --- | --- |
| 원본 기능 테스트 | `succeeded`, 0 / 0 | 9개, 실패 0, XML 2개 `fresh` | `current` |
| 테스트 assertion을 바꾼 뒤 report만 실행 | 기존 성공 기록 유지 | 이전 실행의 9개를 그대로 표시 | `changed` |
| 의도한 assertion 실패 실행 | `failed`, 1 / 1 | core 4개, 실패 1, XML 1개 `fresh` | `current` |
| assertion을 복원한 뒤 재실행 | `succeeded`, 0 / 0 | 9개, 실패 0, XML 2개 `fresh` | `current` |

실패 실행에서는 core 테스트가 실패한 뒤 Gradle이 중단돼 web 테스트를 실행하지 않았습니다.
이전 web XML은 `evidence.files`에 `stale`로 남았으며 새 테스트 합계와 증거 사본에서는
제외됐습니다. 각 실행의 새 XML 합계를 CLI와 report에
대조했고, 원본 XML과 실행 증거 사본의 SHA-256도 일치했습니다.

| 로컬 실행 기록 | run ID |
| --- | --- |
| 첫 성공, 이후 `changed`로 표시된 기록 | `fa0b30a4-7b22-4ae0-8cb1-029ee8f51cc4` |
| 최신 실패로 선택된 기록 | `36ac1385-c6cf-4600-96a3-aff08532e525` |
| 복원 후 새 성공 기록 | `7fad8fa2-354f-491e-8bc4-65e630f8ddf6` |

실패 직후 `--run-id` 없이 실행한 report의 핵심 필드는 다음과 같았습니다.

```json
{
  "status": "generated",
  "exitCode": 0,
  "run": {
    "runId": "36ac1385-c6cf-4600-96a3-aff08532e525",
    "status": "failed",
    "exitCode": 1
  },
  "freshness": { "status": "current" }
}
```

보고서 생성은 성공했지만 선택한 테스트는 실패했습니다. 과거 성공 run을 대신 선택하지
않았습니다. 복원 후에는 새 성공 run을 선택했고, 복사본의 추적 파일과 원본 tiny-memo의
HEAD 및 작업 트리는 시작 상태와 같았습니다. 원문 JSON, 로그와 XML은 로컬 검증 산출물이며
이 문서에는 판정에 필요한 필드와 run ID만 기록합니다.
개인 경로를 제외한 [검증 결과 요약](evidence/tiny-memo-2026-11-15.json)도 함께 보관합니다.
이 파일은 당시 기록에서 추출한 값이며 원문 로그와 XML 전체를 포함하지 않습니다.

## 원격 CI 근거

tiny-memo의 [Actions 실행 43629354802](https://github.com/50h33/tiny-memo/actions/runs/43629354802)는
커밋 `e9b0e2ef6d1c15367537dd983bdad1815e650270`에서 성공했습니다. 각 job의 저장된
실행 기록과 XML, report를 대조했습니다. 세 환경 모두 테스트 9개, 실패/오류/생략 0개,
새 XML 2개와 `freshness: current`였습니다.

| 환경 | dev-cycle run ID |
| --- | --- |
| [Windows](https://github.com/50h33/tiny-memo/actions/runs/43629354802/job/132552288367) | `3093c36c-bfca-452e-be57-338724ad33f5` |
| [Ubuntu](https://github.com/50h33/tiny-memo/actions/runs/43629354802/job/132552287660) | `519e578f-6e2b-44ce-9fc3-907e4a04c054` |
| [macOS](https://github.com/50h33/tiny-memo/actions/runs/43629354802/job/132552287480) | `1ab67ca3-7970-416c-9753-481c4ebfd4f0` |

CI가 사용한 dev-cycle은 `f6e1e1232976c9bd6f8cda6dd09862fd18aa7a2b`입니다. 기록의
`baseRef`는 `main`이고 `baseCommit`과 `mergeBase`는 모두 최초 설치 커밋 `ab69c016...`입니다.
현재 원격 브랜치 위치로 실행 당시 비교 기준을 추정하지 않습니다.

이 결과는 tiny-memo의 실제 Gradle 통합 결과입니다. dev-cycle 자체의 Node stub 기반
자동 테스트와 구분합니다. macOS 한 사례의 성공으로 제품의 공식 지원 범위를 확대하지는
않으며, [지원 환경과 제약](test.md#지원하는-프로젝트)은 별도로 확인해야 합니다.

## 같은 구간 재현하기

[시작 가이드](quickstart.md)의 Node.js 22.17.0 이상 22 계열, npm 10 이상과 Git,
Java 21 및 Gradle 의존성을 준비하세요. 아래 PowerShell 예시는 추가 격리 검증에 사용한
dev-cycle과 tiny-memo의 커밋을 모두 고정합니다. `dev-cycle-case`, `tiny-memo-case`가 아직
없는 디렉터리에서 실행하고, 각 준비 명령이 성공한 뒤 다음 단계로 진행하세요.
이미 설치된 tiny-memo 커밋을 복제하는 재현 절차이며 최초 설치 경험은 위 설치 기록을 따릅니다.

```powershell
git clone https://github.com/50h33/dev-cycle dev-cycle-case
git -C dev-cycle-case switch --detach 9d797fc71f1d130a814f0c9d440e546aefb28a35
npm --prefix dev-cycle-case ci
npm --prefix dev-cycle-case run build
$cli = (Resolve-Path dev-cycle-case/dist/cli.js).Path

git clone https://github.com/50h33/tiny-memo tiny-memo-case
git -C tiny-memo-case switch --detach e9b0e2ef6d1c15367537dd983bdad1815e650270
$caseRoot = (Resolve-Path tiny-memo-case).Path
$baseline = 'ab69c016962019bf1b599671d154e99d951fe1b1'

node $cli init $caseRoot --dry-run --json
node $cli test $caseRoot --base-ref $baseline --dry-run --json
node $cli test $caseRoot --base-ref $baseline --json
node $cli report $caseRoot --json
```

실패와 노후화는 이 폐기 가능한 복사본에서만 재현합니다. `MemoStoreTest.java`의
`missingFileIsEmptyWithoutCreatingAFile`에 있는 첫 assertion의 기대값 `""`를
`"intentional issue 13 failure"`로 바꿉니다. test를 다시 실행하기 전에 report가 같은 성공
run을 `changed`로 표시하는지 확인합니다. 다음으로 위 test와 report를 실행해 종료 코드 1인
최신 실패를 확인하고, assertion을 원래대로 복원한 뒤 다시 실행해 9개 통과를 확인합니다.
재실행마다 run ID는 달라집니다. report는 기록에 저장된 비교 ref를 사용하므로 별도
`--base-ref` 인자를 받지 않습니다.

## 사용 중 발견한 조건과 한계

- 기존 `.gitignore`는 자동 병합되지 않았습니다. 기존 안내대로 배포 블록을 끝에 배치해
  해결했고 사용자 규칙 보존과 재실행 결과를 확인했습니다.
- 소스에서 빌드한 CLI 경로를 직접 지정해야 했습니다. init은 PATH에 명령을 등록하지
  않으며 새 세션에도 같은 준비가 필요합니다.
- 기능이 main에 반영된 뒤에는 당시 변경 범위를 재현할 비교 커밋이 필요했습니다.
  위 예시는 고정 커밋을 명시해 테스트가 생략되는 혼동을 줄입니다.
- 이번 흐름에서 dev-cycle 지원 범위 안의 실행을 막는 코드 결함은 발견하지 않았습니다.
  변경은 사례와 사용 안내에 한정하며 CLI 동작이나 의존성을 바꾸지 않았습니다.
- Claude Code의 실제 역할 발견, `/test`와 `/dev-cycle`, 모델 실행은 확인하지 않았습니다.
  Codex에서 CLI를 실행한 작업이므로 템플릿 설치를 Claude Code 실행 성공으로 세지 않습니다.
- tiny-memo는 저장 중 강제 종료 시 기존 메모를 잃고 일부 데이터만 남는 문제가
  [추가 검증](https://github.com/50h33/tiny-memo/blob/e9b0e2ef6d1c15367537dd983bdad1815e650270/docs/additional-verification.md)에
  기록돼 있습니다. 대상 앱의 내구성 문제이며 CLI 검증 성공이나 이번 수정에 포함하지 않습니다.

이 사례는 [이슈 #13](https://github.com/50h33/dev-cycle/issues/13)의 독립 저장소 적용 근거입니다.
초기 최소 프로젝트 검증, 실제 앱 테스트, 의도적으로 만든 실패, 원격 CI와 미검증 항목을
각각 구분해 사용해야 합니다.
