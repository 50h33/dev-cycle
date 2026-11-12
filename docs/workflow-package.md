# Claude Code 템플릿

dev-cycle은 Claude Code용 에이전트, 명령, 스킬, 설정 파일을 `templates/workflow/`에서
관리합니다. `init`은 manifest에 등록된 파일만 대상 Git 저장소에 설치합니다. 이 저장소 자체를
운영하는 `.claude/` 파일은 배포 대상과 구분합니다.

## 설치 파일

다음 파일을 대상 저장소에 설치합니다.

| 설치 경로 | 역할 |
| --- | --- |
| `.claude/agents/researcher.md` | 사실과 근거를 조사하고 정해진 형식으로 보고합니다. |
| `.claude/agents/planner.md` | 변경 파일, 작업 단계, 위험, 검증 계획을 작성합니다. |
| `.claude/agents/reviewer.md` | 변경을 독립적으로 검토하고 Must/Should/Nit으로 분류합니다. |
| `.claude/agents/gardener.md` | 문서, 설정, 미사용 항목, 링크, 권한을 점검합니다. |
| `.claude/commands/dev-cycle.md` | 이슈 확인부터 조사, 계획, 승인, 구현, 테스트, 리뷰까지 작업 순서를 안내합니다. |
| `.claude/commands/test.md` | Gradle 테스트 대상을 확인하고 dev-cycle CLI로 실제 실행 결과를 기록합니다. |
| `.claude/commands/review-pr.md` | 현재 PR head를 확인하고 선택한 리뷰 코멘트를 게시합니다. |
| `.claude/commands/resume.md` | 작업 메모와 Git 상태를 대조해 다음 작업을 제안합니다. |
| `.claude/commands/wrap-up.md` | 완료한 일, 결정, 변경, 다음 작업을 정리합니다. |
| `.claude/skills/issue/SKILL.md` | 저장소의 이슈 양식과 작업 유형에 맞춰 이슈를 작성합니다. |
| `.claude/skills/pr/SKILL.md` | 실제 변경과 검증 결과를 바탕으로 PR 초안을 작성합니다. |
| `.claude/skills/apply-review/SKILL.md` | 현재 PR head와 미해결 스레드를 확인해 리뷰를 반영하거나 거절합니다. |
| `.claude/claude-progress.txt.example` | 현재 작업, 직전 작업, 다음 작업, 막힌 점을 기록하는 예시입니다. |
| `.claude/feature_list.json.example` | 작업 항목과 상태를 구조화해 기록하는 예시입니다. |
| `.claude/settings.json` | plan을 기본 권한 모드로 설정합니다. |
| `docs/dev-cycle-workflow.md` | 역할, 승인, 실패 대응, 권한 제한을 설명합니다. |

이 파일과 함께 대상 저장소용 `CLAUDE.md`, 실제 사용할 `dev-cycle.config.json`, Git 제외 패턴도 설치합니다. 개인 권한
파일인 `settings.local.json`, 실제 작업 메모와 로그는 설치하지 않습니다. 자동 commit 명령과
임의의 hook도 추가하지 않습니다.

## manifest와 렌더링

[`templates/manifest.json`](../templates/manifest.json)의 `schemaVersion: 1`은 manifest 구조의
버전이고, `templateVersion`은 배포 템플릿의 버전입니다. `root`는 manifest가 있는 디렉터리를
기준으로 한 템플릿 루트입니다. `files`의 source는 템플릿 루트, target은 대상 Git 루트를
기준으로 해석합니다. 목록에 있는 파일만 설치하며 디렉터리 전체를 재귀 복사하지 않습니다.
`gitignore.template`은 설치할 때 `.gitignore`가 됩니다. npm 패키징 과정에서 `.gitignore`
원본이 제외되므로 배포 소스에는 다른 이름을 사용합니다. 현재 템플릿 버전은 `0.1.4`입니다.

[`src/workflow.ts`](../src/workflow.ts)는 설정을 검사하고 템플릿 문자열을 렌더링합니다.
파일 쓰기, Git 조회, 네트워크 요청, 프로세스 실행은 하지 않습니다.
[`src/init.ts`](../src/init.ts)는 대상 Git 루트와 manifest를 검사해 전체 설치 계획을 만듭니다.
충돌이 없을 때만 실제 파일을 씁니다.

- `parseWorkflowConfig(unknown)`: 검증한 설정을 반환합니다. 오류에는 항목 경로와 수정 방법이 있습니다.
- `renderWorkflowTemplate(text, config)`: `{{configJson}}`은 JSON 데이터로,
  `{{artifactsDir}}`은 Git 제외 경로로 바꿉니다. 값이 없거나 지원하지 않는 토큰은 오류입니다.
- 설정과 렌더링 단계에서는 명령 인자를 JSON 배열로 유지하며 shell 명령 문자열로 합치지 않습니다.
- 설정값을 여러 문서에 복제하지 않습니다. 배포 문서는 실행할 때 Git 루트의
  `dev-cycle.config.json`을 읽습니다.

설정 예시는 [`examples/dev-cycle.config.json`](../examples/dev-cycle.config.json)에서 확인할 수
있습니다. 전체 필드는 [배포용 사용 가이드](../templates/workflow/docs/dev-cycle-workflow.md)의
프로젝트 설정 절을 따릅니다.

비교 기준은 명시한 `baseRef`를 먼저 사용하고, 이 값이 없으면 `defaultBranch`를 사용합니다.
나머지 필드는 직접 지정해야 합니다. 환경변수나 전역 설정을 합치지 않고 origin도 추정하지
않습니다. init 역시 origin, 현재 브랜치, 원격 조회 결과로 설정값을 채우지 않습니다. 대상
루트의 기존 설정이나 `--config`로 지정한 설정만 사용하며, 설치 전에 검증한 값을 보여줍니다.

알 수 없는 키, 지원하지 않는 schemaVersion, 잘못된 저장소/ref, 루트 밖으로 나가는 경로,
Windows 예약 이름, 잘못된 명령/인자 구조, 산출물 경로 충돌은 거부합니다. 경로는 `/`로
구분한 상대 경로여야 하며 glob은 사용할 수 없습니다. 영향 경로 목록에서만 마지막 `/`가
해당 디렉터리 아래의 모든 경로를 뜻합니다. 기본 브랜치는 HEAD가 아닌 짧은 이름이어야 합니다.
비교 ref에는 HEAD나 `refs/heads/`로 시작하는 전체 ref도 사용할 수 있습니다.

전체 영향 경로나 공통 모듈이 문서 경로와 겹치면 전체 테스트를 우선합니다. 이 선택은 `test`
CLI가 수행하고, 설정 검사기는 입력된 목록을 그대로 유지합니다. `commands.test`는 필수입니다.
다른 명령도 같은 구조로 추가할 수 있습니다. `windows` 설정이 있으면 Windows에서 executable과
args를 모두 해당 값으로 바꾸며 기존 배열과 이어 붙이지 않습니다.

설정 검사 단계에서는 입력한 문자열과 구조가 규칙에 맞는지 확인합니다. init을 실행하면 실제
파일, 링크/junction, Git이 이미 추적하는 소스와 산출물 경로의 충돌, 설치 파일 충돌도 추가로
확인합니다. 필수 Git/Node 외의 명령, Claude Code, JDK, Gradle을 설치하거나 권한을
추가하지 않습니다.

## 대상 저장소에 설치

소스 빌드부터 실제 테스트와 보고서 생성까지는 [시작 가이드](quickstart.md)를 참고하세요.
현재 문서는 소스에서 빌드해 배포하는 방법만 안내하며 공개 npm 패키지 설치를 전제로 하지
않습니다.

dev-cycle을 빌드하고 대상 프로젝트 설정을 준비한 뒤, 먼저 `init --dry-run`으로 대상 파일
19개의 생성, 유지, 충돌, 오류 상태를 확인하세요. 충돌이나 사전 검사 오류가 하나라도 있으면
새 파일도 쓰지 않습니다. 기존 파일을 덮어쓰거나 자동으로 합치는 옵션은 없습니다.

```sh
npm ci
npm run build
node /absolute/path/to/dev-cycle/dist/cli.js init /absolute/path/to/project \
  --config /absolute/path/to/project-config.json \
  --dry-run
```

대상 Git 루트에 유효한 `dev-cycle.config.json`이 있으면 `--config`를 생략할 수 있습니다.
dry-run이 준비 상태로 끝나면 `--dry-run`을 제거해 적용하세요. 설정에 적은 지침이나 이슈/PR
양식 경로가 없으면 경고를 표시합니다. 다만 해당 경로가 용도에 맞는 파일 또는 디렉터리인지,
실행 파일이 실제로 있고 실행할 수 있는지는 검사하지 않습니다. 이 항목은 대상 프로젝트에서
직접 확인하세요. 설치 후 대상 Git 루트에서
Claude Code를 열고 `/agents`에서 네 역할을 확인한 뒤 `/resume`, `/dev-cycle <이슈 번호>`
등을 사용하세요.

명령, 충돌 처리, JSON 출력, 종료 코드, 쓰기 실패 복구 방법은 [init 사용법](init.md)을
따릅니다. 기존 `.gitignore`를 유지하려면 렌더링된 블록 전체를 파일 끝에 직접 추가하세요.
다른 공유 파일을 사용자가 병합하면 패키지 원본과 계속 충돌할 수 있습니다. 프로젝트 규칙은
별도 지침 파일로, 개인 권한은 `settings.local.json`으로 분리하는 방법을 우선하세요.

템플릿의 `dev-cycle test`와 `dev-cycle report`는 CLI 호출을 뜻합니다. 소스 빌드를 사용하는
환경에서는 `dev-cycle`을 `node /absolute/path/to/dev-cycle/dist/cli.js`로 바꿔 실행하세요.
Claude Code에도 빌드한 CLI의 실제 경로를 제공해야 합니다. `init`은 PATH에 명령을 등록하지
않습니다. 현재 `/test`는 CLI의 `test --dry-run`으로 선택 결과를 먼저 확인한 뒤 실제 실행을
진행하도록 안내합니다.

CLI는 정적 Gradle 최상위 모듈과 루트 Wrapper를 지원하고, 실행 결과와 코드 지문을 기록합니다.
코드 지문은 테스트 당시 파일 상태를 나중에 비교하기 위한 SHA-256 해시입니다. 설정 파일은
일반적인 명령 데이터를 저장할 수 있지만, 실제 실행기가 허용하는 명령과 인자 범위는 더
좁습니다. [test 사용법](test.md)에서 지원 문법, Windows 실행 제한, 결과 신선도, 검증 범위를
확인하세요. 신선도는 테스트 당시 코드와 현재 코드가 같은지를 뜻합니다.

`report`는 저장된 실행 상태와 현재 코드/설정의 신선도를 비교해 PR 본문용 Markdown을 만듭니다.
[report 사용법](report.md)에서 최신 기록을 고르는 방법, 파일 출력, 오래된 결과 표시를
확인하세요. 실행하지 않았거나 실패한 테스트를 통과로 표시하지 않습니다. 개발과 리뷰 판단은
Claude Code가 담당하며, 템플릿 자체가 독립 프로세스나 LLM 실행 엔진으로 동작하지는 않습니다.

## 검증 범위

`npm run check`는 설정 오류, 두 프로젝트의 렌더링, 배포 파일 목록, 내부 링크, Git 제외 규칙,
기존 훅을 검사합니다. 빈 Git 저장소 설치, dry-run 전후 파일 불변, 충돌 시 전체 중단, 같은
저장소에 재실행, 실행 기록 선택, report 신선도와 출력도 확인합니다. 임시 Git 저장소를
사용하므로 외부 서비스, Gradle, Claude 인증은 필요하지 않습니다.

Claude Code 파일 형식은 2026-11-09 Windows / Node.js 22.17.0 / Claude Code 2.1.289에서
`claude plugin validate .claude --strict --json`으로 확인했습니다. 오류와 경고 없이 끝났지만
결과의 `contents`가 빈 배열이어서 실제로 에이전트를 찾았다는 결과로 볼 수는 없습니다.
자동 테스트에서는 각 역할과 스킬의 필수 frontmatter, 이름 충돌을 별도로 검사합니다.

`/agents`에서의 에이전트 발견, 모델 실행, GitHub 게시 동작은 확인하지 않았습니다.
