# AGENTS.md

dev-cycle의 도구 중립 작업 지침입니다. 저장소를 수정하는 에이전트는 이 문서에서 시작합니다.

## 작업 원칙

- 요청된 범위를 먼저 확인하고, 명확한 로컬 작업은 구현과 검증까지 이어서 수행합니다.
- 파일·경로·동작은 검색이나 실행 결과로 확인하며 추측하지 않습니다.
- 범위를 벗어난 리팩터링, 의존성 추가, 외부 게시 작업은 별도 요청 없이 수행하지 않습니다.
- 기존 사용자 변경과 관련 없는 작업 트리 변경을 보존합니다.

## 브랜치와 커밋

- 기본 브랜치는 `main`입니다. 작업 브랜치는 `main`에서 만듭니다.
- 작업 브랜치 이름은 `{이슈 라벨}/{이슈 번호}` 형식을 사용합니다. 예: `feature/12`.
- `main`에 직접 커밋하지 않습니다.
- 커밋 메시지는 [`.githooks/commit-msg`](.githooks/commit-msg)의 형식을 따릅니다.

| 이슈 라벨 | 커밋·PR 타입 |
| --- | --- |
| `feature` | `Feat` |
| `fix` | `Fix` |
| `refactor` | `Refactor` |
| `test` | `Test` |
| `docs` | `Docs` |
| `chore` | `Chore` |
| `infra` | `Infra` |

## 개발 명령

- 의존성 설치: `npm ci`
- 린트: `npm run lint`
- 타입 검사: `npm run typecheck`
- 테스트: `npm test`
- 빌드: `npm run build`
- 전체 검증: `npm run check`

변경과 직접 관련된 검증부터 실행하고, 완료 전 `npm run check`를 실행합니다. 실행하지 못한 검증은 이유와 함께 보고합니다.

## GitHub 작업

- PR의 base는 `main`입니다.
- 이슈·PR·리뷰에 기록하는 내용은 실제 변경과 검증 결과만 사용합니다.
- 숫자 범위는 `~` 대신 `-`로 표기합니다. 예: `5-10분`.
- 원격 push, 이슈·PR 생성, 리뷰 답글 등 외부 변경은 사용자 요청 범위 안에서만 수행합니다.
- 이슈 작성은 [`.claude/skills/issue/SKILL.md`](.claude/skills/issue/SKILL.md), PR 작성은 [`.claude/skills/pr/SKILL.md`](.claude/skills/pr/SKILL.md), 리뷰 반영은 [`.claude/skills/apply-review/SKILL.md`](.claude/skills/apply-review/SKILL.md)를 따릅니다.

## 문서 책임

- `AGENTS.md`: 공통 작업 규칙, 브랜치 규칙, 개발 명령
- `.githooks/commit-msg`: 커밋 메시지 형식
- `.github/ISSUE_TEMPLATE/`: 이슈 양식
- `.github/pull_request_template.md`: PR 본문 양식
