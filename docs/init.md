# init 사용법

`dev-cycle init`은 `templates/manifest.json`에 명시된 Claude Code 워크플로 파일을
대상 Git 저장소에 설치한다. 네트워크, 외부 스킬 설치, Git 설정 변경, commit이나 push는
수행하지 않는다. 개인 권한 파일, 실제 로그와 작업 메모도 설치하지 않는다.

## 실행 전 준비

dev-cycle 저장소에서 Node.js 22.17.0 이상 22 계열과 npm 10 이상으로 빌드한다.
별도 디렉터리에서 설치부터 실제 테스트와 보고서까지 실행하는 예시는
[최소 Gradle 따라 하기](quickstart.md)를 참고한다.

```sh
npm ci
npm run build
```

[`examples/dev-cycle.config.json`](../examples/dev-cycle.config.json)을 복사해 대상 저장소명,
기본 브랜치, 비교 ref, 문서 경로와 테스트 명령을 채운다. init은 origin이나 브랜치,
프로젝트 명령을 추정하거나 원격에서 조회하지 않는다.

## 설치 계획 확인과 적용

대상 저장소 밖에 설정 초안을 둔 경우 명시적으로 전달한다.

```sh
node /absolute/path/to/dev-cycle/dist/cli.js init /absolute/path/to/project \
  --config /absolute/path/to/project-config.json \
  --dry-run
```

Windows에서는 공백이 있는 경로 전체를 따옴표로 감싼다.

```powershell
node "C:\tools\dev cycle\dist\cli.js" init "C:\work\한글 project" `
  --config "C:\configs\project config.json" `
  --dry-run
```

대상 경로를 생략하면 현재 디렉터리를 사용한다. Git 저장소의 하위 디렉터리를 전달해도
Git 루트를 찾으며 첫 커밋이 없는 일반 저장소도 지원한다. Git 저장소가 아닌 경로와 bare
저장소는 거부한다. `--config`의 상대 경로는 대상 저장소가 아니라 명령을 실행한 현재
디렉터리를 기준으로 한다. `--config`를 생략하면 대상 Git 루트의
`dev-cycle.config.json`을 읽는다.
명시적으로 전달한 빈 경로는 오류다. 빈 문자열을 현재 저장소나 기본 설정으로 바꾸지 않는다.
Windows의 8.3 짧은 경로 별칭은 실제 긴 경로로 정규화하며 출력의 `root`도 이 경로를 사용한다.

dry-run이 `ready`이고 종료 코드가 0이면 같은 명령에서 `--dry-run`만 제거해 설치한다.
dry-run은 대상 파일과 디렉터리, Git 설정, 로그와 메모를 만들거나 수정하지 않는다.

```sh
node /absolute/path/to/dev-cycle/dist/cli.js init /absolute/path/to/project \
  --config /absolute/path/to/project-config.json
```

## 계획과 충돌

init은 쓰기 전에 manifest, 설정, 템플릿 렌더링과 모든 대상 경로를 검사한다. 각 파일은
다음 상태 중 하나로 표시된다.

| 상태 | 의미 |
| --- | --- |
| `create` | 새로 만들 예정인 파일. 전체 계획이 중단되면 생성하지 않음 |
| `created` | 실제 실행에서 만든 파일 |
| `unchanged` | 이미 설치할 내용과 같아 보존한 파일 |
| `conflict` | 기존 내용이 달라 사용자가 처리해야 하는 파일 |
| `error` | 읽기, 경로 검사 또는 쓰기에 실패한 파일 |
| `not-created` | 앞선 쓰기 실패 때문에 만들지 못한 파일 |

충돌이나 사전 검사 오류가 하나라도 있으면 새 파일이 섞여 있어도 아무것도 쓰지 않는다.
기존 `CLAUDE.md`, `.claude/settings.json`, 명령과 스킬을 덮어쓰거나 자동 병합하는 옵션은
없다. 프로젝트 설정은 의미가 같으면 공백이나 키 순서가 달라도 기존 파일을 그대로 보존한다.
공유 템플릿은 UTF-8 텍스트이며 LF/CRLF 차이만 있으면 기존 바이트를 유지한다. 설정 JSON과
아래 `.gitignore`의 별도 비교 규칙을 제외하면 마지막 개행의 유무, 단독 CR과 실제 내용 차이는 충돌이다.

`.gitignore`가 충돌하면 기존 규칙을 보존하면서 `templates/workflow/gitignore.template`의
`{{artifactsDir}}`를 설정값으로 치환한 템플릿 블록 전체를 파일 끝에
수동으로 추가한다. LF/CRLF와 마지막 빈 줄 차이는 허용하며, 블록 뒤에는 다른 규칙을 두지 않는다.
뒤에 오는 `!` 예외 규칙이 제외를 되돌릴 수 있으므로 일부 패턴이 파일 중간에 있다는 것만으로
설치된 것으로 판단하지 않는다. 재실행은 끝 블록이 일치하고 개인 설정, 실제 작업 메모와
로그, `artifactsDir` 산출물이 `git check-ignore --no-index`에서 모두 제외되는 경우
`.gitignore`를 `unchanged`로 처리한다.
루트 `.gitignore`를 새로 만드는 경우 보호 대상의 상위 디렉터리에 있는 `.gitignore`를
확인한다. 여기에 `!`로 시작하는 예외 규칙이 있으면 쓰기 전에 중단하므로 수동 검토가 필요하다.
아직 없는 디렉터리의 예외는 Git 조회만으로 예측하기 어려워, 보호 대상과 무관한 예외도
보수적으로 중단한다. 단, 제외할 디렉터리 내부의 `.gitignore`는 부모의 제외를 되돌릴 수
없으므로 그 안의 예외 때문에 중단하지 않는다. `.git/info/exclude`와 전역 규칙도 새 루트
규칙보다 우선순위가 낮으므로 이 사전 차단 대상에 포함하지 않는다.
대표 경로 검사이므로 모든 미래 파일명에 대한 제외를 증명하지는 않는다.

다른 공유 파일을 프로젝트 내용과 합친 결과는 패키지 내용과 달라 계속 충돌할 수 있다.
`CLAUDE.md`의 프로젝트 규칙은 가능하면 설정의 `paths.conventions`가 가리키는 별도 문서로,
개인 권한은 `.claude/settings.local.json`으로 옮긴다. 같은 경로의 명령이나 스킬을 수정해야
한다면 manifest를 기준으로 필요한 파일을 수동 배치하고, init dry-run의 해당 충돌을
해결되지 않은 차이로 관리해야 한다. init은 사용자 병합본을 승인 상태로 기록하거나 선택한
파일만 설치하지 않는다.

같은 설정으로 설치를 다시 실행하면 모든 배포 파일이 `unchanged`이고 생성 파일은 0개다.
강제 덮어쓰기와 복잡한 롤백은 MVP 범위에 포함하지 않는다.

## 실패와 복구

사전 검사를 통과한 뒤 권한이나 디스크 오류가 발생하면 init은 성공으로 보고하지 않는다.
이미 만든 파일과 디렉터리, 실패한 파일과 아직 만들지 못한 파일을 결과에 남긴다. 새 파일을
연 뒤 쓰기에 실패했다면 `partial: true`로 표시할 수 있으므로 해당 파일의 내용을 반드시
확인한다. 원인을 고치고 부분 파일을 검토하거나 제거한 뒤 dry-run부터 다시 실행한다.

| 종료 코드 | 의미 |
| --- | --- |
| `0` | 유효한 dry-run 또는 설치 완료 |
| `1` | 기존 파일 충돌로 전체 설치 중단 |
| `2` | 잘못된 입력, Git/경로 검사 오류 또는 파일 I/O 실패 |

`--json`을 사용하면 stdout에는 JSON 객체 하나만 출력된다. init 실행 결과는 `schemaVersion`,
`command`, `dryRun`, `root`, `status`, `templateVersion`, `config`, `files`,
`createdDirectories`, `errors`, `warnings`, `exitCode`를 포함한다. `status`는 유효한
dry-run의 `ready`, 설치를 마친 `completed`, 충돌한 `blocked`, 오류가 난 `failed`다.
사람이 읽는 출력과 JSON은 같은 계획, 충돌과 오류를 표현한다.
명령 구문 오류는 `schemaVersion`, `command`, `status`, `errors`, `exitCode`를 반환한다.
충돌의 구체적인 조치는 `files[].message`에 있고 `errors`는 설정/경로/I/O 오류에 사용한다.
도움말과 버전 출력은 각각 `status: help`와 `status: version`인 JSON으로 반환한다.

## 경로와 보안 경계

manifest의 source와 target은 각 루트 안의 일반 파일이어야 한다. 절대 경로, `..`, 중복,
파일과 디렉터리의 접두 충돌, Windows에서 대소문자만 다른 경로를 거부한다. 대상 경로의
기존 심볼릭 링크와 Windows junction도 따라가지 않는다. `artifactsDir`가 파일이나 링크이거나
이미 추적된 소스를 포함하는 경우에도 설치하지 않는다.

이 검사는 설치 시점에 확인한 파일 시스템 상태를 기반으로 한다. 다른 프로세스가 검사와
쓰기 사이에 경로나 파일을 악의적으로 바꾸는 상황을 격리하는 보안 샌드박스는 아니다.
신뢰하는 로컬 저장소에서 실행하고, 공유 디렉터리에서는 설치하는 동안 다른 쓰기를 멈춘다.
Git 조회는 하위 프로세스에서만 저장소/인덱스/탐색 환경변수와 추적 로그 설정을 격리한다.
사용자의 환경변수나 Git 설정 파일은 변경하지 않는다. Trace2 설정도 로그를 만들 수 있어
[Git이 문서화한 비활성화 값](https://git-scm.com/docs/git#Documentation/git.txt-GITTRACE2)을 적용한다.
Windows 예약 이름은 `CONIN$`, `CONOUT$`, `COM¹` 같은 장치 이름도 거부한다.
기준은 [Windows 파일 이름 규칙](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#naming-conventions)과
[DOS 장치 이름 규칙](https://learn.microsoft.com/en-us/windows/win32/devnotes/rtlisdosdevicename_u#remarks)이다.

TicketRush 원본에는 dry-run만 적용한다. 실제 파일 생성과 재실행 검증은 폐기 가능한
격리 저장소나 원본의 복사본에서 수행한다.

## 검증 기록

2026-11-09 Windows / Node.js 22.17.0에서 `npm run check`의 lint, 타입 검사,
테스트 73개와 빌드를 통과했다. 핵심 검사는 Node와 Git만 사용하며 외부 서비스나
실제 Gradle, Claude 인증이 필요하지 않다.

- 공백과 한글 경로의 빈 Git 저장소, 충돌, 반복 dry-run, 재실행, 링크/junction,
  대소문자와 manifest 경로, 실제 일부 바이트 기록 후 디스크 오류를 검증했다.
- 추가 검토에서 Git trace 로그 생성, 소문자 Git 환경변수, 빈 경로, Windows 예약 장치 이름,
  첫 설치의 하위 Git 제외 예외, CRLF 재설치 문제를 재현하고 수정 전 실패/수정 후 통과를 확인했다.
  Git 탐색 제한 환경변수에 영향을 받지 않는 하위 경로 조회도 검사했다.
- Windows CI에서 드러난 8.3 별칭/Git 루트 비교 오류를 로컬에서 재현했다. 별칭 경로의
  dry-run, 실제 설치와 재실행을 검사하며 별칭 조회에 Windows 기본 `cmd.exe`를 사용한다.
- 로컬 tarball 설치 후 패키지의 CLI로 19개 파일 dry-run을 확인했다.
  소스 checkout의 빌드 CLI로는 격리 저장소에 19개 파일 실제 설치와 무변경 재실행을 확인했다.
- TicketRush 원본 dry-run은 기존 파일 17개의 충돌을 반환했고, 설치 대상과 상위 경로의
  스냅샷, Git 설정/index와 Git 상태가 유지됐다. 원본에 설치하거나 테스트를 실행하지 않았다.
- 격리된 설치물의 `claude plugin validate .claude --strict --json`은 종료 코드 0이었다.
  결과의 `contents`가 빈 배열이므로 실제 `/agents` 발견이나 모델 실행을 검증한 결과로 보지 않는다.

GitHub Actions의 커밋별 결과는 PR Checks에서 별도로 확인한다.
기존 Windows/Ubuntu CI가 동일한 자동 테스트를 실행하도록 유지한다.
