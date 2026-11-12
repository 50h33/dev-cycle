# 시작 가이드

기존 저장소에 dev-cycle을 설치하고 Claude Code로 이슈 조사, 계획, 구현, 테스트, 리뷰,
PR 작업을 진행하는 방법입니다. 마지막에는 CLI로 테스트와 보고서를 직접 실행하는 방법도
설명합니다. 명령의 경로, 이슈 번호와 PR 번호는 작업할 저장소의 값으로 바꾸세요.

## 1. CLI 빌드

Node.js 22.17.0 이상 22 계열, npm 10 이상, Git을 준비하세요.
이 저장소를 clone한 디렉터리에서 실행합니다.

```sh
npm ci
npm run build
node /path/to/dev-cycle/dist/cli.js --help
```

`/path/to/dev-cycle`은 clone한 저장소의 실제 경로로 바꾸세요. 아래 명령에서도 같은 경로를
사용합니다. 경로에 공백이 있다면 전체를 따옴표로 감싸주세요.

## 2. 대상 저장소와 설정 준비

AI 워크플로에는 Claude Code가 필요합니다. GitHub 이슈와 PR을 조회하거나 게시할 때는 사용할
도구에 해당 저장소의 인증과 필요한 권한도 준비돼 있어야 합니다.

CLI로 테스트할 저장소에는 JDK와 Gradle Wrapper가 준비되어 있어야 합니다. `settings.gradle`에
모듈 이름을 직접 선언한 프로젝트를 지원하며, Kotlin DSL이나 동적 모듈 설정은 지원하지 않습니다.
전체 조건은 [지원하는 프로젝트](test.md#지원하는-프로젝트)를 확인하세요.

[`설정 파일 예시`](../examples/dev-cycle.config.json)를 대상 저장소 밖의 새 파일로 복사하고,
다음 항목을 프로젝트에 맞게 수정하세요. 기존 설정 파일이 있다면 새로 덮어쓰지 말고 그 파일을 사용하세요.

| 항목 | 확인할 내용 |
| --- | --- |
| `repository` | `owner/repository` 형식의 저장소 이름 |
| `defaultBranch` | 프로젝트의 기본 브랜치 이름 |
| `baseRef` | 코드 변경을 비교할 ref. PR 검증에는 로컬에서 읽을 수 있는 PR base 브랜치(`main`, `origin/main` 등)를 지정합니다. |
| `paths` | 프로젝트 지침, 이슈 양식, PR 양식의 경로 |
| `commands.test` | Gradle Wrapper 경로와 인자. Windows용 설정이 있으면 그 실행 파일과 인자를 사용합니다. |
| `test` | 공통 모듈, 전체 테스트가 필요한 경로, 테스트를 생략할 수 있는 문서 경로 |
| `artifactsDir` | 실행 결과를 저장할 전용 디렉터리. 예시 값은 `.dev-cycle`입니다. |

예시의 `trunk`와 `origin/trunk`를 그대로 쓰기 전에 실제 저장소에 있는 ref인지 확인하세요.
CLI는 원격에서 ref를 가져오거나 기본 브랜치를 추측하지 않습니다. `test`를 실행하려면
HEAD 커밋도 있어야 합니다. `paths.conventions`에는 작업 브랜치와 커밋 규칙, 개발과 검증 명령을
설명한 문서를 지정하세요. 이슈와 PR 양식 경로도 실제 파일과 맞는지 확인합니다. 설정에 사용할 수
있는 값은 [설정 안내](workflow-package.md#manifest와-렌더링)를 참고하세요.

`HEAD`도 비교 ref로 사용할 수 있지만 현재 커밋 이후의 미커밋 변경만 검사합니다. 커밋 후 작업
트리가 깨끗하면 변경이 없는 것으로 판단해 테스트를 생략하므로, PR 전체 변경을 검증할 때는
PR base 브랜치를 사용하세요.

## 3. 설치할 파일 확인

아래의 `/path/to/project`는 테스트할 저장소 경로, `/path/to/project-config.json`은 준비한
설정 파일 경로로 바꾸세요.

```sh
node /path/to/dev-cycle/dist/cli.js init /path/to/project --config /path/to/project-config.json --dry-run
```

이 명령은 파일을 쓰지 않고 설치할 내용을 보여줍니다. 결과가 `ready`이면 다음 단계로
진행하세요. `blocked`나 `conflict`가 나오면 [충돌 처리](init.md#계획과-충돌)를 먼저 확인해야 합니다.
기존 파일을 덮어쓰거나 자동으로 합치는 옵션은 없습니다.

```sh
node /path/to/dev-cycle/dist/cli.js init /path/to/project --config /path/to/project-config.json
node /path/to/dev-cycle/dist/cli.js init /path/to/project
```

첫 번째 명령이 파일을 설치합니다. 두 번째 명령으로 다시 실행했을 때 설치된 파일이 모두
`unchanged`라면 기존 내용이 그대로 유지된 것입니다. 이후에는 대상 Git 루트에 설치된
`dev-cycle.config.json`을 읽으므로 `--config`를 생략할 수 있습니다.

`init`은 PATH에 `dev-cycle` 명령을 등록하지 않습니다. 이후에도 `node .../dist/cli.js`로
실행하세요. Claude Code의 `/test`나 PR 스킬을 쓸 때도 빌드한 CLI의 실제 경로를 알려줘야 합니다.
CLI 대신 Gradle을 직접 실행하면 dev-cycle 실행 기록은 남지 않아 `report`로 그 결과를 읽을 수 없습니다.

## 4. Claude Code에서 설치 확인

대상 저장소의 Git 루트에서 Claude Code를 열고 `/agents`로 `researcher`, `planner`,
`reviewer`, `gardener`를 확인하세요. 각 역할은 설치된 `.claude/agents/`에 정의돼 있습니다.
역할이 보이지 않으면 설치 위치와 파일을 확인하고 세션을 다시 여세요.

빌드한 CLI의 실제 경로를 대화에서 알려주세요.

```text
dev-cycle CLI는 /path/to/dev-cycle/dist/cli.js야. node로 실행해 줘.
```

공유 설정은 `plan`을 기본 권한 모드로 사용합니다. 구현이나 테스트 실행에 필요한 권한은
Claude Code의 현재 권한 설정에 따릅니다. 작업을 요청했다는 사실과 도구 실행 권한은 별개이며,
`init`이 개인 권한을 추가하지는 않습니다.

## 5. 이슈를 준비하고 구현 시작

작업할 이슈가 있으면 해당 번호를 사용하세요. 없다면 Claude Code에 요구사항과 이슈 작성
범위를 알려줍니다. 다음처럼 `/issue`를 직접 호출할 수 있습니다.

```text
/issue
지금 설명한 요구사항을 저장소 양식에 맞는 이슈 초안으로 정리해 줘.
```

이슈 스킬은 기존 이슈와 양식을 확인하고 작업 범위와 완료 조건을 정리합니다. 이미 완료한
작업을 기록하는 경우에는 그 사실을 알려주세요. 게시까지 필요하면 이슈 생성을 요청하고,
생성된 이슈 번호를 확인한 뒤 개발 사이클을 시작합니다.

```text
/dev-cycle 123
```

`/dev-cycle`은 다음 순서로 진행합니다.

1. 이슈와 설정의 저장소가 일치하는지 확인합니다.
2. `researcher`가 관련 코드와 요구사항을 조사합니다.
3. `planner`가 변경 파일, 구현 순서, 위험과 검증 계획을 정리합니다.
4. 새 결정이 필요한 사항을 확인하고, 요청된 범위에서 작업 브랜치를 준비해 코드와 테스트를 작성합니다.
5. `/test`로 실제 테스트를 실행합니다.
6. `reviewer`가 변경을 검토하고, 타당한 지적을 반영한 뒤 다시 검증합니다.
7. CLI `report`로 PR에 사용할 검증 결과를 정리합니다.

이미 요청한 로컬 구현과 실패 수정은 반복 확인 없이 진행합니다. 범위가 넓어지거나 새 설계
선택이 필요하면 그 부분을 구분해 확인합니다. 기존 작업 트리는 보존하며 기본 브랜치에서
직접 구현하지 않습니다.

전체 사이클 대신 필요한 단계만 요청할 수도 있습니다.

```text
researcher로 이 이슈와 관련된 코드와 테스트를 조사해 줘.
planner로 조사 결과를 바탕으로 구현 계획을 세워 줘.
/test
reviewer로 현재 브랜치 변경을 검토해 줘.
```

에이전트는 조사, 계획, 검토 결과를 보고하며 직접 코드를 수정하지 않습니다. 실제 수정은
메인 대화의 Claude Code가 요청 범위 안에서 수행합니다.

## 6. 검증 결과로 PR 작성

테스트가 실패했다면 원인을 고친 뒤 다시 실행하세요. 리뷰 반영 후 코드가 바뀌었을 때도
재검증해야 합니다. CLI의 `report`는 실행 결과와 현재 코드의 일치 여부를 별도로 보여주며,
검증하지 않은 현재 코드를 과거 통과 결과로 대신하지 않습니다.

PR 스킬은 기준 ref 이후 커밋과 diff, 이슈와 PR 양식을 읽고 실제 검증 결과를 본문에 넣습니다.
커밋, push, PR 게시가 필요하면 원하는 범위를 함께 요청하세요.

```text
저장소 규칙에 맞게 커밋하고 push한 뒤 PR을 작성해 줘.
```

이 요청에서는 구현과 리뷰 중의 검증을 마치고 커밋한 뒤, 최종 `/test`와 `report`를 실행해
검증 상태를 확인하고 push와 PR 작성을 진행합니다. 실행 기록에 HEAD와 index도 포함되므로
테스트 후 `git add`나 커밋만 해도 이전 결과가 `changed`로 표시될 수 있습니다. 최종 테스트는
앞서 설정한 PR base 브랜치와 비교해야 커밋한 변경까지 선택합니다. 다시 검증하지 못했다면
PR에 현재 코드가 미검증이라는 표시를 남깁니다.

이미 커밋한 변경으로 초안만 확인하려면 다음처럼 요청할 수 있습니다.

```text
/pr
현재 브랜치 변경으로 PR 초안을 작성해 줘.
```

PR 게시가 요청되면 저장소와 base 브랜치를 확인하고, 게시 후 head, base, 제목과 본문을 다시
조회합니다. 기본 브랜치이거나 기준 ref 이후 커밋이 없으면 상태를 보고하고 게시하지 않습니다.

## 7. PR 리뷰와 피드백 반영

올라온 PR에 리뷰를 남기려면 `/review-pr`을 사용합니다.

```text
/review-pr 456
```

현재 PR head의 실제 파일과 코멘트 위치를 확인하고 Must/Should/Nit으로 분류한 제안을
보여줍니다. 게시할 항목을 지정하면 그 범위만 게시합니다. 현재 작업 브랜치의 변경을
검토하는 `reviewer`와 달리, 이 명령의 결과는 원격 PR에 남길 리뷰 제안입니다.

내 PR에 달린 코멘트를 처리하려면 `/apply-review`를 사용하세요.

```text
/apply-review
현재 PR의 미해결 코멘트를 확인하고 수용, 거절, 보류로 나눠 줘.
```

현재 브랜치와 PR head를 비교하고, 해결된 스레드와 중복 답글을 제외합니다. 수용할 항목을
이미 지정했다면 해당 수정을 바로 수행하고 검증합니다. 판단이 남은 항목만 확인하며,
push, 답글과 resolve도 요청한 범위에서 수행합니다.

CI가 실패했다면 해당 실행의 실패 단계와 로그를 확인하고 원인을 수정하세요. 변경 후 로컬
검증을 거쳐 요청된 push를 수행하고 새 CI 결과를 확인합니다. 로컬 테스트 기록만으로 CI도
통과했다고 표시하지 않습니다. 테스트, 리뷰, CI 결과를 확인한 뒤에도 머지는 별도로 요청한
범위에서 진행합니다.

## 8. 세션 마무리와 다음 작업

작업을 마칠 때 `/wrap-up`을 실행하세요. 대화, Git 상태, 실행 기록으로 확인한 작업, 주요 결정,
변경과 커밋, 검증 결과와 다음 할 일을 정리합니다.

개인 메모가 필요하면 `.claude/claude-progress.txt.example`을 참고해 실제 메모를 작성하고,
작업 목록은 `.claude/feature_list.json.example`의 `todo`/`doing`/`done` 형식을 사용할 수
있습니다. 실제 파일 이름은 각각 `.claude/claude-progress.txt`, `.claude/feature_list.json`이며
Git에서 제외됩니다. `/wrap-up`이 이 파일들을 자동으로 작성하는 것은 아닙니다.

다음 세션에서는 `/resume`을 실행하세요. 메모를 현재 브랜치, 변경 파일, 최근 커밋, 이슈 상태와 대조하고
다음 작업 하나를 제안합니다. 오래된 메모보다 실제 상태를 우선하며, 메모가 없어도 Git 상태를
확인할 수 있습니다. 구현은 작업 범위를 정해 `/dev-cycle`로 이어갑니다.

소스에서 빌드한 CLI를 사용한다면 새 세션에도 실제 경로를 알려주세요. `init`, `/resume`,
`/wrap-up`은 이 경로를 별도로 저장하거나 PATH에 등록하지 않습니다. 4단계와 같은 방법으로
CLI 위치를 알려준 뒤 테스트와 PR 작업을 진행하세요.

설정이나 문서를 바꾼 뒤에는 다음처럼 유지보수 점검을 요청할 수 있습니다.

```text
gardener로 Claude Code 설정과 문서의 불일치, 깨진 링크와 불필요한 권한을 점검해 줘.
```

`gardener`는 지적과 정리 방향을 보고합니다. 수정할 내용은 메인 대화에서 요청하세요.
각 기능의 상세 절차와 설치 파일은 [Claude Code 워크플로 가이드](workflow-package.md)를 참고하세요.

## CLI로 테스트와 보고서 직접 실행

아래 명령은 터미널에서 실행합니다. Claude Code 없이도 사용할 수 있으며, `/test`와 PR 스킬이
활용하는 것과 같은 CLI 실행 기록을 만듭니다.

### 테스트 실행

먼저 어떤 테스트가 선택되는지 확인하세요.

```sh
node /path/to/dev-cycle/dist/cli.js test /path/to/project --dry-run --json
```

JSON의 `selection.tasks`에 실행할 태스크가, `selection.reasons`에 선택 이유가 나옵니다.
예를 들어 공통 모듈이 아닌 `app`의 코드만 바뀌었다면 `:app:test`를 선택합니다. 공통 모듈이 바뀌었거나 변경의
영향을 판단할 수 없다면 전체 테스트를 선택합니다. 변경이 없거나 설정에 지정한 문서만
바뀌었다면 테스트를 생략합니다. 자세한 내용은 [선택 규칙](test.md#선택-규칙)을 참고하세요.

실제 테스트는 `--dry-run`을 빼고 실행합니다.

```sh
node /path/to/dev-cycle/dist/cli.js test /path/to/project
```

프로세스 종료 코드, 실행한 태스크, 이번 실행의 XML 테스트 수를 확인하세요.
`UP-TO-DATE`나 `FROM-CACHE`이면 테스트를 새로 실행한 것으로 집계하지 않습니다.
실패하거나 중단됐다면 원인을 해결한 뒤 다시 실행하세요. 이전 기록을 덮어쓰지 않고 새 기록을 만듭니다.

### 보고서 확인과 저장

```sh
node /path/to/dev-cycle/dist/cli.js report /path/to/project
node /path/to/dev-cycle/dist/cli.js report /path/to/project --json
```

기본 출력은 PR 본문에 붙일 수 있는 Markdown입니다. `--json`을 쓰면 Markdown과 실행 기록,
현재 코드와의 비교 결과를 함께 읽을 수 있습니다. 최신 실행이 실패했거나 생략됐으면 그 상태를
그대로 보여줍니다.

`freshness`에서 테스트 당시 코드와 현재 코드가 같은지 확인하세요. `current`이면
기록 시점과 같고, `changed`이면 테스트 중이나 이후에 코드나 설정 등이 바뀐 것입니다.
`unknown`이나 `incomplete`이면 현재 코드가 검증됐다고 볼 수 없습니다.

테스트를 통과한 뒤 코드를 고쳤다면 다시 테스트하고 보고서를 새로 만드세요.
`report`가 정상 종료했다는 사실만으로 테스트도 통과했다고 판단하면 안 됩니다.
상태별 의미는 [report 사용법](report.md#테스트-이후-코드-변경-확인)에 있습니다.

파일로 저장하려면 `--output`을 지정하세요. 아래 명령은 `artifactsDir`가 `.dev-cycle`일 때의 예시입니다.

```sh
node /path/to/dev-cycle/dist/cli.js report /path/to/project --output .dev-cycle/reports/pr-tests.md
```

보고서는 설정한 `artifactsDir` 아래의 `reports/`에만 저장할 수 있습니다. 기존 파일은
덮어쓰지 않으므로 같은 이름이 있다면 다른 파일명을 지정하세요. 파일을 저장하기 전에
확인하려면 `--dry-run`을 추가하면 됩니다.
