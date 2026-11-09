---
name: pr
description: 현재 브랜치의 확인된 변경과 검증 결과로 PR 초안을 작성하고, 사용자가 게시를 요청한 경우 main 대상으로 생성한다.
---

# PR 작성

[`.github/pull_request_template.md`](../../../.github/pull_request_template.md)를 사용해 현재 작업 브랜치의 PR을 작성합니다.

공통 브랜치·GitHub 표기·외부 작업 규칙은 [`AGENTS.md`](../../../AGENTS.md)를 따릅니다.

## 규칙

- base 브랜치는 `main`입니다. 현재 브랜치가 `main`이거나 커밋이 없으면 게시하지 않고 상태를 보고합니다.
- 제목은 `[Type] #이슈번호 요약` 형식이며 `Feat`, `Fix`, `Refactor`, `Docs`, `Test`, `Chore`, `Infra`만 사용합니다.
- `git log main..HEAD`, `git diff --stat main...HEAD`, 필요 시 전체 diff에서 확인한 사실만 적습니다.
- 테스트 항목에는 실제 실행한 명령과 결과만 기록합니다. 실행하지 못한 검증은 이유를 명시합니다.
- 원격 push와 PR 생성은 사용자가 요청한 경우에만 수행합니다. 그 요청에 포함됐다면 중복 확인 없이 진행합니다.
- 리뷰어는 사용자가 지정한 경우에만 추가합니다. 라벨은 존재 여부를 확인하고 없으면 생략합니다.

## 절차

1. `git branch --show-current`, `git status --short --branch`, `git log --oneline main..HEAD`로 게시 가능 상태를 확인합니다.
2. 브랜치 끝의 숫자에서 이슈 번호를 얻고, 가능하면 `gh issue view <번호>`로 이슈 내용을 확인합니다.
3. 커밋과 diff를 근거로 제목과 템플릿 본문을 작성합니다. UI 변경이 없으면 스크린샷 영역을 HTML 주석으로 남깁니다.
4. `gh repo view --json nameWithOwner -q .nameWithOwner`로 현재 저장소를 확인합니다.
5. 게시가 요청됐다면 작업 브랜치를 push한 뒤 다음 형태로 PR을 생성합니다.

```sh
gh pr create --base main --title "[Type] #123 요약" --body-file <file> --assignee @me
```

라벨이나 명시된 리뷰어가 있으면 확인 후 해당 옵션을 추가합니다. PR 게시가 요청되지 않았다면 제목·본문 초안과 현재 상태까지만 보고합니다.

## 결과 보고

- 제목, base, 라벨, 리뷰어, 담당자
- PR 본문 또는 생성된 PR URL
- 실행한 검증과 결과
- 미커밋·미푸시 변경 등 게시 전 남은 상태
