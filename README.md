# dev-cycle
AI 개발 흐름과 테스트를 관리하는 TypeScript CLI

## 워크플로 템플릿

TicketRush의 기존 Claude Code 에이전트, 명령과 스킬을 추출해 다른 저장소에서도
사용할 수 있도록 프로젝트별 설정을 분리합니다. 배포 파일은 `templates/workflow/`,
설정 예시는 [`examples/dev-cycle.config.json`](examples/dev-cycle.config.json)에 있습니다.

[추출 파일 대응, 설정 계약과 수동 사용법](docs/workflow-package.md)을 먼저 확인하세요.
현재는 템플릿과 설정 검증을 제공하며, 자동 설치 `init`, 변경 모듈 실행 `test`,
실행 기록 기반 `report` CLI는 후속 이슈에서 구현합니다.

## 개발 환경

- Node.js 22.x (22.17.0 이상), npm 10 이상, Git
- `.nvmrc`는 Node.js 22 계열을 지정합니다. CI도 같은 계열을 사용합니다.
- GitHub 이슈·PR 작업 스킬을 사용할 때는 GitHub CLI(`gh`)와 저장소 접근 권한이 필요합니다.

저장소 루트에서 실행합니다.

```sh
npm ci
npm run check
```

`npm ci`는 lockfile에 고정된 개발 의존성을 설치하고 `prepare` 단계에서
이 저장소의 `core.hooksPath`를 `.githooks`로 설정합니다. 기존 사용자 전역 Git 설정은 변경하지 않습니다.
`--ignore-scripts`로 설치했다면 `npm run prepare`를 별도로 실행해야 합니다.

## 검증 명령

| 명령 | 수행 내용 |
| --- | --- |
| `npm run lint` | TypeScript와 개발 스크립트의 ESLint 검사 |
| `npm run typecheck` | 소스와 테스트의 strict 타입 검사, 파일 출력 없음 |
| `npm test` | TypeScript 테스트를 `.test-dist/`로 컴파일하고 Node 내장 테스트 러너로 실행 |
| `npm run build` | 이전 `dist/`를 비우고 `src/`를 컴파일 |
| `npm run check` | lint → 타입 검사 → 테스트 → 빌드 순서로 전체 검증 |

현재 테스트는 실제 `commit-msg` 훅과 배포 템플릿, 설정 검사와 프로젝트별 렌더링을
확인합니다. 테스트 실행 전에 이전 `.test-dist/` 산출물을 지웁니다.
`src/index.ts`는 설정 검사와 문자열 렌더링 함수를 내보내며 CLI 명령은 아직 없습니다.

## 작업 규칙과 CI

- 공통 작업 규칙: [AGENTS.md](AGENTS.md), Claude 진입점: [CLAUDE.md](CLAUDE.md)
- 작업 브랜치: `main` 기준 `{이슈 라벨}/{이슈 번호}` (예: `chore/1`)
- 커밋 메시지: `[Chore] #1 TypeScript 개발 환경 구성`
- PR 제목: 같은 형식을 사용하며 여러 이슈 번호도 허용합니다. 예: `[Chore] #1, #2 개발 환경 보완`
- 이슈·PR 양식과 이슈 작성·PR 작성·리뷰 반영 스킬은 `AGENTS.md`에서 안내합니다.

코드 검증 CI는 `main`으로 향하는 PR, `main` push 또는 수동 실행 시 Windows와 Ubuntu에서
설치·lint·타입 검사·테스트·빌드를 실행합니다. PR 제목 검사는 PR 생성·제목 편집·재개·커밋 추가 시 실행됩니다.
로컬 검증 결과와 GitHub Actions 실행 결과는 구분하여 기록합니다.

## 초기 검증 결과

2026-11-09, Windows / Node.js 22.17.0 / npm 10.9.2 기준:

- 설치, lint, 타입 검사, 커밋 훅 테스트 23개, 빌드 통과.
- PR 제목 검사 22개 사례와 YAML·문서 링크 검사 통과.
- `npm audit`: 개발 의존성의 `minimatch` 관련 moderate 경고 10건.
  현재 호환 범위 내 수정 버전이 없으며, `npm audit --omit=dev` 결과는 0건입니다.
- GitHub Actions와 Ubuntu 러너, 이슈·PR·리뷰 스킬의 실제 게시 동작은 미검증입니다.
