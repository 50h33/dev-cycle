# 워크플로 추출과 배포 계약

TicketRush의 기존 Claude Code 파일을 추출해 프로젝트 의존성을 분리했다.
저장소 운영용 `.claude/`와 다른 저장소에 제공할 `templates/workflow/`를 분리하며,
init은 이 추출물을 manifest의 허용 목록에 따라 설치한다.

## 파일 대응

원본은 TicketRush-backend의 커밋
[`c493caf2fa69a4a7e0e19f243872c3741f98fc61`](https://github.com/TicketRush/TicketRush-backend/tree/c493caf2fa69a4a7e0e19f243872c3741f98fc61)이다.
다음 표의 원본 경로는 그 저장소 기준이며 원본 자체는 수정하지 않았다.

| 원본 | 배포 경로 | 유지한 것과 바꾼 것 |
| --- | --- | --- |
| `.claude/agents/researcher.md` | 동일 | 사실과 근거 조사, 보고 형식 유지. 팀명과 지침 경로 분리 |
| `.claude/agents/planner.md` | 동일 | 변경 파일, 단계, 위험, 검증 계획 유지. Java/Spring 규칙 제거 |
| `.claude/agents/reviewer.md` | 동일 | 독립 리뷰와 Must/Should/Nit 유지. 특정 아키텍처와 고정 diff 기준 제거 |
| `.claude/agents/gardener.md` | 동일 | 문서/설정/미사용 항목/링크/권한 점검 유지 |
| `.claude/commands/dev-cycle.md` | 동일 | 이슈 확인, 조사, 계획, 승인, 구현, 테스트, 리뷰 순서 유지. 자동 커밋과 원격 사이클 제거 |
| `.claude/commands/test.md` | 동일 | 실제 실행만 보고. Gradle 자동 모듈 선택과 실제 결과 기록 CLI로 연결 |
| `.claude/commands/review-pr.md` | 동일 | PR head의 실제 위치 검증과 선택한 코멘트 게시. 프로젝트별 리뷰 규칙 제거 |
| `.claude/commands/resume.md` | 동일 | 메모/Git 대조와 다음 작업 제안. 메모 자동 생성과 고정 40% 임계 없음 |
| `.claude/commands/wrap-up.md` | 동일 | 한 일, 결정, 변경, 다음 작업 요약 유지. Slack 전송 제거 |
| `.claude/skills/issue/SKILL.md` | 동일 | 실제 양식과 작업 유형 사용. 조직 Issue Type과 팀 제목 규칙 고정 제거 |
| `.claude/skills/pr/SKILL.md` | 동일 | 실제 변경과 검증으로 초안 작성. 기준 ref와 양식 경로 분리 |
| `.claude/skills/apply-review/SKILL.md` | 동일 | 현재 PR head 대조, 미해결 스레드 분류와 수용/거절 유지 |
| `.claude/claude-progress.txt.example` | 동일 | 지금/직전/다음/막힌 점. 실제 날짜, 브랜치와 이슈 번호 제거 |
| `.claude/feature_list.json.example` | 동일 | 기존 updated_at/current_branch/items/desc/status/issue 구조 유지. 실제 작업값 제거 |
| `.claude/settings.json` | 동일 | plan 기본값만 유지. PowerShell 로깅 훅과 개인 허용 권한 제외 |
| `docs/ai-workflow-guide.md` | `docs/dev-cycle-workflow.md` | 역할, 승인, 실패 대응, 권한 한계와 출처 중심으로 정리 |

대상 저장소가 읽을 `CLAUDE.md`, 설정 예시, 필요한 Git 제외 패턴과 배포 manifest는
추출물을 연결하는 최소 파일이다. 자동 commit 명령, hook, 실제 메모/로그,
settings.local.json과 외부 grill-me/grilling 본문은 배포하지 않는다.
기존 dev-cycle 운영용 스킬의 승인 범위 보존, 재조회와 미게시 커밋 링크 제한도 반영했다.

## manifest와 렌더링

[`templates/manifest.json`](../templates/manifest.json)의 `schemaVersion: 1`은 manifest 구조,
`templateVersion`은 배포 템플릿 버전을 나타낸다. `root`는 manifest가 있는 디렉터리
기준 템플릿 루트이고 `files`의 source/target은 각각 템플릿 루트/대상 Git 루트 기준이다.
목록은 허용 목록이며 디렉터리 전체를 재귀 복사하는 지시가 아니다.
`gitignore.template`은 설치 시 `.gitignore`가 된다. npm 패키징이 `.gitignore` 원본을
제외하므로 배포 소스에는 별도 이름을 사용한다. 현재 템플릿 버전은 `0.1.3`이다.

[`src/workflow.ts`](../src/workflow.ts)는 설정 검사와 문자열 렌더링만 제공한다.
파일 쓰기, Git 조회, 네트워크나 프로세스 실행은 하지 않는다.
[`src/init.ts`](../src/init.ts)는 대상 Git 루트와 manifest를 검사해 전체 설치 계획을 만든 뒤,
충돌이 없는 실제 실행에서만 파일을 쓴다.

- `parseWorkflowConfig(unknown)`: 검증한 설정을 반환한다. 오류에는 항목 경로와 수정 방법이 있다.
- `renderWorkflowTemplate(text, config)`: `{{configJson}}`은 JSON 데이터로,
  `{{artifactsDir}}`은 Git 제외 경로로 치환한다. 미지정/잘못된 토큰은 오류다.
- 설정/렌더링 단계에서는 명령 인자를 JSON 배열로 유지하고 shell 명령 문자열로 조합하지 않는다.
- 문서마다 설정값을 복제하지 않는다. 배포 문서는 실행할 때 Git 루트의 `dev-cycle.config.json`을 읽는다.

설정 예시는 [`examples/dev-cycle.config.json`](../examples/dev-cycle.config.json)에 있다.
전체 필드는 [배포용 사용 가이드](../templates/workflow/docs/dev-cycle-workflow.md)의 프로젝트 설정 절을 따른다.

설정 적용 순서는 명시적 `baseRef`, 그 값이 없으면 `defaultBranch`다. 나머지 필드는
명시해야 한다. 이 단계에서는 환경변수/전역 설정 병합이나 origin 추론을 하지 않는다.
init도 이 값을 origin, 현재 브랜치나 원격 조회로 추정하지 않는다. 대상 루트의 기존 설정이나
`--config`로 명시한 설정만 사용하고 설치 전에 검증한 값을 보여준다.

알 수 없는 키, 미지원 schemaVersion, 잘못된 저장소/ref, 경로 이탈, Windows 예약 이름,
잘못된 명령/인자 구조와 산출물 경로 충돌을 거부한다. 경로는 `/` 구분 상대경로이며
globs를 쓰지 않는다. 영향 경로 목록에서만 마지막 `/`가 디렉터리 하위를 뜻한다.
기본 브랜치는 HEAD가 아닌 짧은 이름, 비교 ref는 HEAD나 `refs/heads/` 같은 전체 ref도 허용한다.
전체 영향 경로나 공통 모듈이 문서 경로와 겹치면 전체 테스트를 우선한다. 이 선택 로직은
`test` CLI가 수행하며 설정 검사기는 목록을 보존한다.
`commands.test`는 필수이고 다른 명령은 같은 구조로 추가한다. `windows`가 있으면
Windows에서 executable과 args 둘 다 그 값으로 대체하며 배열을 이어 붙이지 않는다.

설정 검사는 문자열 계약 검사이며 init은 실제 파일, 링크/junction, 이미 추적되는 소스와의
산출물 경로 충돌과 설치 충돌을 추가로 검사한다. 필수 Git/Node 외의 명령, Claude Code,
JDK와 Gradle을 설치하거나 권한을 추가하지 않는다.

## 다른 저장소에 설치

소스 빌드부터 실제 테스트와 보고서까지는 [최소 Gradle 따라 하기](quickstart.md)를 참고한다.
현재 안내하는 배포 방식은 소스 빌드이며 공개 npm 패키지 설치를 전제로 하지 않는다.

dev-cycle을 빌드하고 대상 프로젝트 설정을 준비한 뒤, 먼저 `init --dry-run`으로 19개
대상 파일의 생성, 유지, 충돌과 오류를 확인한다. 충돌 또는 사전 검사 오류가 하나라도 있으면
새 파일도 쓰지 않는다. 기존 파일을 덮어쓰거나 자동 병합하는 옵션은 없다.

```sh
npm ci
npm run build
node /absolute/path/to/dev-cycle/dist/cli.js init /absolute/path/to/project \
  --config /absolute/path/to/project-config.json \
  --dry-run
```

대상 Git 루트에 유효한 `dev-cycle.config.json`이 있으면 `--config`를 생략할 수 있다.
dry-run이 준비 상태로 끝나면 `--dry-run`을 제거해 적용한다. 설정된 지침과 이슈/PR 양식의
경로가 없으면 경고한다. 경로의 용도에 맞는 파일/디렉터리인지와 실행 파일의 존재/실행 가능
여부는 검사하지 않으므로 대상 프로젝트에서 확인해야 한다. 저장소 운영 규칙과 CI는
가져오지 않는다. 설치 후 대상 Git 루트에서 Claude Code를 열고 `/agents`에서 네 역할을
확인한 뒤 `/resume`, `/dev-cycle <이슈 번호>` 등을 사용한다.

명령, 충돌 처리, JSON 출력, 종료 코드와 쓰기 실패 복구는 [init 사용법](init.md)을 따른다.
기존 `.gitignore`는 렌더링된 블록 전체를 파일 끝에 수동 추가하면 유지할 수 있다. 다른
공유 파일의 사용자 병합본은 계속 충돌할 수 있으므로 프로젝트 규칙과 개인 권한을 별도
지침 파일과 `settings.local.json`으로 분리하는 방식을 우선한다.

템플릿의 `dev-cycle test`/`dev-cycle report` 표기는 CLI 호출을 뜻한다. 소스 빌드를 사용하는
환경에서는 `dev-cycle` 부분을 `node /absolute/path/to/dev-cycle/dist/cli.js`로 바꿔 실행하며,
Claude Code에도 빌드한 CLI의 실제 경로를 제공한다. `init`은 PATH에 명령을 등록하지 않는다.
현재 `/test`는 CLI의 `test --dry-run`으로 선택을 확인하고 실제 실행을 진행하도록 안내한다.
CLI는 정적 Gradle 최상위 모듈과 루트 Wrapper를 지원하며 결과와 코드 지문을 기록한다.
일반적인 명령 데이터를 저장하는 설정 계약보다 실행기의 허용 명령과 인자 범위는 좁다.
[test 사용법](test.md)에서 지원 문법, Windows 경계, 결과 신선도와 검증 범위를 확인한다.
`report`는 저장된 실행 상태와 현재 코드/설정의 신선도를 비교해 PR 본문용 Markdown을 만든다.
[report 사용법](report.md)에서 최신 기록 선택, 파일 출력과 오래된 결과 표시를 확인한다.
미실행/실패를 통과로 쓰지 않으며 개발/리뷰 판단은 Claude Code가 담당한다. 템플릿 자체가
독립 프로세스나 LLM 실행 엔진인 것은 아니다.

## 검증 경계

`npm run check`는 설정 오류, 두 프로젝트 렌더링, 배포 허용 목록, 내부 링크,
Git 제외 규칙과 기존 훅에 더해 빈 Git 저장소 설치, dry-run 무변경, 충돌 시 전체 중단과
동일 저장소 재실행, 실행 기록 선택과 report 신선도/출력을 검사한다. 임시 Git 저장소를 쓰며
외부 서비스/Gradle/Claude 인증은 필요 없다.

Claude Code 파일 형식 확인은 별도로 격리된 디렉터리에서
`claude plugin validate .claude --strict --json`으로 수행한다. 2.1.289에서 원본 형식의
명령 5개에 description 누락 경고가 나와 설명 메타데이터를 보완했다. 보완 후 strict 검증은
오류/경고 없이 종료하지만 빈 contents 배열을 런타임 발견 성공으로 해석하지 않는다.
핵심 자동 검사로 각 역할/스킬의 필수 frontmatter와 이름 충돌을 확인한다.

2026-11-09 Windows / Node.js 22.17.0 / Claude Code 2.1.289에서 격리된 Git 저장소로
배포물을 렌더링했다. 명령 검증의 오류와 경고는 없었다. 대화형 확인은 Claude Code의
최초 설정 화면에서 종료했으므로 `/agents`의 실제 발견, 모델 실행과 GitHub 게시 동작은
미검증이다. 개인 전역 설정을 바꾸거나 인증을 진행하지 않았다.
