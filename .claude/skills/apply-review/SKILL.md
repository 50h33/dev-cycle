---
name: apply-review
description: 현재 PR의 미해결 리뷰 코멘트를 분석하고, 요청 범위에 따라 수정하고 검증하며 게시가 요청된 경우 답글을 작성한다.
---

# 리뷰 반영

리뷰 코멘트를 현재 PR 코드에 다시 매핑해 타당성을 판단하고, 수용한 항목만 좁게 수정합니다.

브랜치 규칙, GitHub 표기와 외부 작업 규칙은 [`AGENTS.md`](../../../AGENTS.md)를 따릅니다.

## 규칙

- 현재 브랜치가 PR의 `headRefName`과 일치하는지 먼저 확인합니다.
- 코멘트의 diff 라인을 그대로 믿지 않고 PR head의 현재 파일과 다시 대조합니다.
- 해결된 스레드와 후속 답글은 중복 작업하지 않습니다.
- 리뷰 범위를 벗어난 리팩터링을 하지 않습니다.
- 수정은 의미가 같은 코멘트끼리 묶고 변경에 맞는 `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`를 실행합니다.
- push, 답글 게시, 스레드 resolve는 사용자가 요청한 외부 변경 범위에 포함된 경우에만 수행합니다.
- 로컬 커밋이 원격 PR에 게시되지 않은 상태에서는 해당 커밋 링크로 답글을 게시하지 않습니다.

## 절차

1. PR 번호가 없으면 `gh pr view --json number -q .number`로 현재 브랜치 PR을 찾습니다.
2. `gh pr view <PR> --json number,headRefName,headRefOid,url`과 현재 브랜치를 비교합니다.
3. `gh repo view --json nameWithOwner -q .nameWithOwner`로 `{owner}/{repo}`를 얻고, `gh api --paginate repos/{owner}/{repo}/pulls/<PR>/comments`로 인라인 코멘트를 모든 페이지에서 읽습니다.
4. GraphQL `reviewThreads(first: 100, after: $cursor)`를 `pageInfo.hasNextPage`가 거짓일 때까지 반복합니다. 각 스레드의 `comments(first: 100, after: $commentCursor)`도 같은 방식으로 끝까지 조회합니다. 해결된 스레드를 제외하고 후속 답글을 루트 코멘트별로 묶습니다.
5. 각 항목을 수용, 거절, 보류로 분류하고 근거를 제시합니다. 사용자가 이미 반영 범위를 정했다면 그 범위를 바로 수행합니다. 판단이 필요한 항목만 결정을 요청합니다.
6. 수용 항목을 현재 PR head와 대조한 뒤 수정하고 검증합니다. 커밋이 요청되었다면 작업 단위로 커밋합니다.
7. 답글 게시가 요청되었다면 원격에서 확인 가능한 커밋에만 링크하고, 거절 항목에는 근거를 답합니다. resolve는 명시적으로 요청된 스레드에만 수행합니다.

## 결과 보고

- 코멘트별 분류와 근거
- 수용 항목의 변경 파일과 검증 결과
- 커밋, push, 답글과 resolve 수행 여부
- 원격에 게시되지 않아 보류한 답글이나 링크
