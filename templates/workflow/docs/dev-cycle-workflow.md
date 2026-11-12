# dev-cycle Claude Code 워크플로

`dev-cycle init`은 이 템플릿에 포함된 Claude Code 에이전트, 명령, 스킬, 작업 메모 형식을
대상 저장소에 설치합니다. 조사, 계획, 구현, 리뷰 판단은 Claude Code가 맡습니다. dev-cycle
CLI는 템플릿 설치, Gradle 변경 영향 테스트, 실제 실행 기록, 기록 기반 report 생성을
담당합니다.

## 구성

| 구성 | 역할 |
| --- | --- |
| `researcher` | 구현 전 코드와 외부 근거 조사 |
| `planner` | 변경 대상, 단계, 위험과 검증 계획 작성 |
| `reviewer` | 제품 코드 변경의 문제와 위험 검토 |
| `gardener` | Claude Code 템플릿, 설정과 문서 정합성 점검 |
| `/dev-cycle` | 이슈 확인부터 로컬 구현, 검증과 요약까지 연결 |
| `/test` | 실제 테스트 실행과 결과 보고 |
| `/review-pr` | 원격 PR 리뷰 코멘트 제안 |
| `/resume` | 작업 메모와 Git 상태를 읽는 재개 안내 |
| `/wrap-up` | 확인된 로컬 작업과 검증 결과 요약 |
| `issue`, `pr`, `apply-review` | 요청 범위 안에서 GitHub 작업 수행 |

자동 commit 명령, Slack 전송, 범용 실행 로그 hook, 외부 스킬 본문은 배포하지 않습니다.
개인 권한 파일, 실제 로그, 작업 메모도 템플릿에 포함하지 않습니다.

이 문서의 `dev-cycle` 표기는 CLI 호출을 뜻합니다. 소스에서 빌드했다면 `dev-cycle` 대신
`node /path/to/dev-cycle/dist/cli.js`를 사용하고, Claude Code에도 빌드한 CLI의 실제 경로를
알려 주세요. `init`은 CLI를 PATH에 등록하지 않습니다.

## 프로젝트 설정

`git rev-parse --show-toplevel`로 확인한 대상 Git 루트의 `dev-cycle.config.json`을 프로젝트
설정으로 사용합니다. 하위 디렉터리에서 시작해도 상대 경로와 명령의 작업 디렉터리는 이
루트를 기준으로 합니다. Git 저장소가 아니거나 루트를 확인할 수 없으면 경로를 추정하지
않습니다.

```json
{
  "schemaVersion": 1,
  "repository": "owner/repository",
  "defaultBranch": "trunk",
  "baseRef": "origin/trunk",
  "paths": {
    "conventions": "AGENTS.md",
    "issueTemplates": ".github/ISSUE_TEMPLATE",
    "prTemplate": ".github/pull_request_template.md"
  },
  "commands": {
    "test": {
      "executable": "./gradlew",
      "args": ["test"],
      "windows": {
        "executable": "./gradlew.bat",
        "args": ["test"]
      }
    }
  },
  "test": {
    "commonModules": [],
    "fullTestPaths": ["build.gradle", "settings.gradle", "gradle/"],
    "documentationPaths": ["docs/", "README.md"]
  },
  "artifactsDir": ".dev-cycle"
}
```

- `schemaVersion`은 반드시 `1`이어야 합니다.
- `repository`는 `owner/name` 형식의 GitHub 저장소 식별자입니다.
- `defaultBranch`에는 브랜치 생성과 PR base에 사용할 짧은 브랜치 이름을 입력합니다. `HEAD`나
  `refs/heads/` 같은 접두사는 넣지 마세요. `baseRef`에는 `HEAD`를 명시할 수 있습니다.
- `baseRef`는 변경 비교 기준입니다. 생략하면 `defaultBranch`를 사용하며 ref를 임의로
  fetch하거나 추정하지 않습니다.
- `paths`에는 Git 루트 기준 상대 경로를 입력합니다.
- `commands`의 각 명령은 `executable`, `args`, 선택적인 `windows` 설정으로 구성합니다.
  값을 단순히 연결하거나 eval하지 않습니다. argv 인터페이스가 없으면 `/test`의 shell 인용과
  미실행 처리 규칙을 따릅니다.
- `test.commonModules`와 영향 경로는 저장소에 맞게 설정합니다. 특정 이름을 공통 모듈로
  가정하지 않습니다.
- `fullTestPaths`와 `documentationPaths`는 glob이 아닙니다. 파일 경로는 정확히 일치해야 하고,
  `/`로 끝나는 항목은 해당 디렉터리 아래의 모든 경로와 일치합니다.
- 경로가 겹치면 전체 영향 경로와 공통 모듈 판정을 문서 생략보다 먼저 적용합니다. 문서 경로에
  포함됐다는 이유로 빌드 설정 변경을 생략하지 않습니다. 분류할 수 없는 변경은 전체 테스트로
  확대합니다.
- `artifactsDir`는 CLI 전용 상대 디렉터리입니다. 저장소 루트 밖이나 기존 소스, 배포 파일과
  겹치는 경로를 지정할 수 없습니다. 기본값이 아닌 경로를 사용하면 해당 경로도 Git에서
  제외하세요.

다른 프로젝트 명령은 `commands`에 같은 구조로 추가할 수 있습니다. 설정하지 않은 명령을
추정해 실행하지 않습니다. `commands.test`는 필수입니다. Windows 설정이 있으면 executable과
args를 모두 그 값으로 바꿉니다. `paths`, 테스트 영향 경로, `artifactsDir`는 `/`로 구분하세요.
저장소 밖 경로, glob, Windows 예약 이름은 사용할 수 없습니다. 실행 파일에는 PATH의 명령
이름, Git 루트 기준 상대 경로, 명시한 절대 경로를 사용할 수 있습니다.

## init 설치와 기존 파일 보존

`dev-cycle init`은 배포 manifest에 등록된 공유 파일만 대상 Git 루트에 설치합니다. 먼저
`--dry-run`으로 모든 파일의 생성, 유지, 충돌, 오류 상태를 확인하세요. dry-run은 대상 파일과
디렉터리, Git 설정, 로그, 메모를 변경하지 않습니다. 충돌이나 사전 검사 오류가 하나라도
있으면 새 파일도 쓰지 않습니다.

기존 CLAUDE.md, settings.json, 스킬, .gitignore의 내용이 다르면 덮어쓰거나 자동으로
합치지 않습니다. `.gitignore`는 렌더링된 제외 블록 전체를 기존 파일 끝에 직접 추가하면
재실행할 때 유지된 파일로 처리합니다. 다른 공유 파일을 사용자가 합치면 계속 충돌할 수
있습니다. 프로젝트 규칙은 `paths.conventions`가 가리키는 별도 문서에 두고, 개인 권한은
`settings.local.json`으로 분리하세요. 개인 권한 파일과 실제 메모/로그는 설치하지 않습니다.
필요한 개발 도구나 실행 파일, 저장소 지침, 이슈/PR 양식은 대상 프로젝트에서 준비하세요.
설치 후 대상 Git 루트에서 Claude Code를 열고 `/agents`로 역할을 확인한 뒤 `/resume` 또는
`/dev-cycle <이슈 번호>`를 사용하세요.

## 권장 흐름

1. researcher가 현재 구현과 관련 자료를 조사합니다.
2. planner가 계획, 위험, 검증 방법을 정리합니다.
3. 새 결정이 필요한 계획과 범위 확대는 개발자가 승인합니다.
4. 승인된 범위에서 구현과 테스트 코드를 작성합니다.
5. `/test`가 실제 테스트를 실행합니다.
6. reviewer가 기준 ref와 현재 변경을 검토하고 타당한 지적을 반영합니다.
7. CLI `report`가 최신 실행 기록과 현재 코드가 같은지 확인해 PR 검증 블록을 만들고,
   `/wrap-up`이 나머지 확인된 작업을 요약합니다.
8. commit, push, PR, 리뷰 답글은 사용자가 요청한 외부 변경 범위에서 수행합니다.

이미 승인된 로컬 구현과 실패 수정은 반복해서 확인하지 않고 이어갑니다. 승인되지 않은 범위
확대, 외부 게시, 되돌리기 어려운 변경은 별도 승인을 받아야 합니다.

## 현재 지원 상태

현재 CLI는 배포용 템플릿과 설정을 검사하고 `init`으로 설치합니다. `test`는 정적 Groovy
`settings.gradle`의 최상위 모듈을 선택해 루트 Gradle Wrapper로 실행하고
`<artifactsDir>/runs/<UUID>/record.json`에 기록합니다. `report`는 최신 기록과 현재
코드/설정을 비교해 PR 본문용 Markdown을 stdout으로 출력합니다.

먼저 `dev-cycle test --dry-run --json`으로 선택 결과와 이유를 확인한 뒤
`dev-cycle test --json`으로 실행하세요. `--base-ref`로 비교 ref를 지정할 수 있습니다.
지원하지 않는 동적 설정, projectDir, composite build, Kotlin DSL을 발견하면 중단합니다.
기본 실행 파일은 `./gradlew`, Windows에서는 `./gradlew.bat`입니다. args의 `test` 하나를
선택된 태스크로 바꾸고 `--console=plain`, `--no-daemon`을 사용합니다. Windows 경로에
따옴표, `% ! ^ & | < > ( )`, 줄바꿈이 있으면 실행 전에 거부합니다. 공백과 한글은
지원합니다. CLI가 없는 환경에서는 `/test`의 직접 실행 절차를 따르되 CLI 기록이 있다고
표시하면 안 됩니다.

실행 상태, 종료 코드, 이번 실행의 XML 결과, 코드 지문을 구분합니다. 코드 지문은 테스트 당시
파일 상태를 나중에 비교하기 위한 SHA-256 해시입니다. 캐시/UP-TO-DATE/NO-SOURCE는 새 테스트
실행이 아닙니다. 실행 전후나 이후에 코드가 바뀌면 이전 결과를 현재 코드의 통과로 사용하지
않습니다. stdout/stderr는 각각 앞 1 MiB까지만 로컬에 보관합니다. 종료 기록이 없는 run은
미완료로 처리합니다.

`dev-cycle report`는 기본적으로 가장 최근에 시작한 기록을 선택합니다. 최신 실패/중단 기록을
과거 성공 기록으로 바꾸지 않으며, 잘못된 run 디렉터리나 손상된 기록을 건너뛰지 않습니다.
`--run-id`로 유효한 UUID를 지정할 수 있지만 과거 기록도 현재 코드와 다시 비교합니다. 기록이
없으면 미실행으로 표시합니다. 저장된 합계에 없는 실패 이름, 커버리지, 수동 시연, 원격 CI
결과는 추정하지 않습니다.

기본 출력은 stdout으로 보내는 Markdown입니다. `--json`은 Markdown, 선택한 실행 기록,
신선도를 JSON 객체 하나로 출력합니다. 신선도는 테스트 당시 코드와 현재 코드가 같은지를
뜻합니다. `--output`은 `<artifactsDir>/reports/` 아래의 새 Markdown 파일만 허용하며 기존
파일, 링크, 추적 파일을 덮어쓰지 않습니다. `--dry-run`은 파일과 디렉터리를 만들지 않습니다.
report가 `changed`, `unknown`, `incomplete`를 표시하면 `/wrap-up`과 PR 스킬도 현재 코드를
검증하지 않았다는 표시를 유지합니다.

## 실패와 재개

- 명령을 시작하지 못했다면 미실행으로 기록합니다.
- 실제 종료 코드가 실패라면 실패로 기록하고, 원인을 고친 뒤 새 실행으로 검증합니다.
- 취소나 신호로 끝났다면 중단으로 기록합니다.
- 문서 변경처럼 설정된 규칙에 따라 테스트하지 않았다면 생략 사유를 적습니다.
- 세션을 다시 열 때 `/resume`은 개인 메모를 Git과 이슈 상태에 대조합니다. 메모가 오래됐다면
  Git과 원격 상태를 우선합니다.

성공, 실패, 중단, 생략, 미실행을 서로 바꿔 쓰지 않습니다. `PreToolUse`는 호출 전 입력만
기록하므로 프로세스 완료나 테스트 성공을 확인하는 자료가 아닙니다. 테스트 이후 코드가
바뀌었거나 당시 상태와 같은지 확인할 수 없으면 다시 검증하거나 현재 코드를 검증하지
않았다고 표시합니다. 예전 성공 결과를 현재 변경의 성공 결과로 사용하지 않습니다.

## 지침과 기술적 제한

에이전트 문서의 “Bash는 조회에만 사용한다”는 작업 지침입니다. 도구 목록에 Bash가 있으면
문장만으로 파일 쓰기를 막을 수는 없습니다. 실제 제한은 Claude Code 권한 규칙, 운영체제
권한, 샌드박스, 차단 hook으로 설정해야 합니다.

공유 `settings.json`은 plan 기본값만 제공합니다. 개인 `settings.local.json`의 권한을
자동으로 추가하거나 넓히지 않습니다. hook을 추가한다면 호출 전 로그와 실행 후 결과를
구분하고, 로깅 실패를 테스트 성공으로 해석하지 마세요.

## 작업 메모

`.claude/claude-progress.txt.example`과 `.claude/feature_list.json.example`만 공유합니다. 실제
파일은 기기에만 두는 보조 자료이며 Git에서 제외합니다. 승인 상태, 검증 결과, 여러 기기
사이의 공유 상태를 메모로 관리하지 않습니다.

## 외부 grill-me 스킬

계획을 질문으로 다듬는 `grill-me`와 내부 `grilling`은 dev-cycle의 자체 기능이 아닙니다.
원본은 [mattpocock/skills](https://github.com/mattpocock/skills)이며
[MIT License](https://github.com/mattpocock/skills/blob/main/LICENSE)를 사용합니다.

Claude Code에서는 upstream이 안내하는 다음 플러그인 설치 명령을 사용할 수 있습니다.

```sh
claude plugin install mattpocock-skills@claude-plugins-official
```

플러그인 설치와 파일 복사 방식 중 하나만 선택하세요. 파일을 복사한다면 `grill-me`가 의존하는
`grilling`도 함께 설치해야 합니다. 설치하지 않았다면 planner 결과에 남은 결정을 일반 질문으로
확인하세요. dev-cycle 템플릿은 두 스킬의 본문을 재배포하지 않습니다.
