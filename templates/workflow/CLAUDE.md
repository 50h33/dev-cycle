# Claude Code 작업 안내

작업을 시작할 때 `git rev-parse --show-toplevel`로 대상 Git 루트를 확인한다. Git 저장소가 아니거나 루트를 확인하지 못하면 경로를 추정하지 않고 원인을 보고한다. 루트의 `dev-cycle.config.json`과 그 파일의 `paths.conventions`가 가리키는 지침을 읽는다.

설정 경로, 작업 메모와 프로젝트 명령의 상대 경로는 모두 이 Git 루트 기준이며 명령의 작업 디렉터리도 Git 루트로 지정한다. 하위 디렉터리에서 시작한 세션에서도 같은 규칙을 따른다.

역할별 조사, 계획과 검토는 `.claude/agents/`를 사용한다. 반복 절차는 `.claude/commands/`, GitHub 이슈와 PR 작업은 `.claude/skills/`에 있다. 설치와 전체 사용 흐름은 `docs/dev-cycle-workflow.md`를 따른다.

설정에 있는 실행 파일과 인자 배열을 유지한다. 현재 패키지는 프로세스 실행기를 제공하지 않는다. 직접 실행할 때 값을 단순 연결하거나 eval하지 않는다. argv 인터페이스가 없으면 `/test`의 shell 인용 규칙을 따르고, 인자를 정확히 전달할 수 없으면 실행하지 않고 이유를 보고한다. `PreToolUse` 로그나 명령 호출 자체를 성공 증거로 사용하지 않고 실제 프로세스 종료와 결과를 확인한다.
