# init 사용법

`dev-cycle init`은 `templates/manifest.json`에 적힌 Claude Code 워크플로 파일을
대상 Git 저장소에 설치합니다. 네트워크에 접속하거나 외부 스킬을 설치하지 않으며,
Git 설정 변경, commit, push도 수행하지 않습니다. 개인 권한 파일, 실제 로그, 작업 메모도
설치 대상에서 제외합니다.

## 실행 전 준비

dev-cycle 저장소에서 Node.js 22.17.0 이상 22 계열과 npm 10 이상을 사용해 빌드하세요.
설정 준비부터 테스트 실행과 보고서 생성까지의 전체 순서는
[시작 가이드](quickstart.md)를 참고하세요.

```sh
npm ci
npm run build
```

[`examples/dev-cycle.config.json`](../examples/dev-cycle.config.json)을 복사한 뒤 대상 저장소명,
기본 브랜치, 비교 ref, 문서 경로, 테스트 명령을 입력하세요. init은 origin, 브랜치,
프로젝트 명령을 추정하거나 원격 저장소에서 조회하지 않습니다.

## 설치 계획 확인과 적용

설정 파일을 대상 저장소 밖에 두었다면 `--config`로 경로를 지정하세요.

```sh
node /absolute/path/to/dev-cycle/dist/cli.js init /absolute/path/to/project \
  --config /absolute/path/to/project-config.json \
  --dry-run
```

Windows에서는 공백이 있는 경로 전체를 따옴표로 감싸세요.

```powershell
node "C:\tools\dev cycle\dist\cli.js" init "C:\work\한글 project" `
  --config "C:\configs\project config.json" `
  --dry-run
```

대상 경로를 생략하면 현재 디렉터리를 사용합니다. Git 저장소의 하위 디렉터리를 지정해도
Git 루트를 찾으며, 첫 커밋이 없는 일반 저장소도 지원합니다. Git 저장소가 아닌 경로와 bare
저장소는 거부합니다. `--config`의 상대 경로는 대상 저장소가 아니라 명령을 실행한 현재
디렉터리를 기준으로 해석합니다. `--config`를 생략하면 대상 Git 루트의
`dev-cycle.config.json`을 읽습니다.

빈 경로를 명시하면 오류가 발생합니다. 빈 문자열을 현재 저장소나 기본 설정으로 바꾸지 않습니다.
Windows의 8.3 짧은 경로 별칭은 실제 긴 경로로 바꾸며, 출력의 `root`에도 긴 경로를 사용합니다.

dry-run 결과가 `ready`이고 종료 코드가 0이면 같은 명령에서 `--dry-run`만 제거해 설치하세요.
dry-run은 대상 파일과 디렉터리, Git 설정, 로그, 메모를 만들거나 수정하지 않습니다.

```sh
node /absolute/path/to/dev-cycle/dist/cli.js init /absolute/path/to/project \
  --config /absolute/path/to/project-config.json
```

## 계획과 충돌

init은 파일을 쓰기 전에 manifest, 설정, 템플릿 렌더링 결과, 모든 대상 경로를 검사합니다.
각 파일에는 다음 상태 중 하나를 표시합니다.

| 상태 | 의미 |
| --- | --- |
| `create` | 새로 만들 예정인 파일. 전체 계획이 중단되면 생성하지 않음 |
| `created` | 실제 실행에서 만든 파일 |
| `unchanged` | 이미 설치할 내용과 같아 보존한 파일 |
| `conflict` | 기존 내용이 달라 사용자가 처리해야 하는 파일 |
| `error` | 읽기, 경로 검사 또는 쓰기에 실패한 파일 |
| `not-created` | 앞선 쓰기 실패 때문에 만들지 못한 파일 |

충돌이나 사전 검사 오류가 하나라도 있으면 새 파일을 만들 수 있더라도 아무것도 쓰지 않습니다.
기존 `CLAUDE.md`, `.claude/settings.json`, 명령, 스킬을 덮어쓰거나 자동 병합하는 옵션은
없습니다. 프로젝트 설정의 의미가 같으면 공백이나 키 순서가 달라도 기존 파일을 그대로 둡니다.
공유 템플릿은 UTF-8 텍스트입니다. LF/CRLF만 다르면 기존 바이트를 유지합니다. 설정 JSON과
아래 `.gitignore`의 별도 비교 규칙을 제외하면 마지막 개행 유무, 단독 CR, 실제 내용의 차이를
충돌로 처리합니다.

`.gitignore`가 충돌하면 기존 규칙은 그대로 두고,
`templates/workflow/gitignore.template`의 `{{artifactsDir}}`를 설정값으로 바꾼 템플릿 블록
전체를 파일 끝에 직접 추가하세요. LF/CRLF와 마지막 빈 줄의 차이는 허용하지만, 블록 뒤에
다른 규칙을 두면 안 됩니다. 뒤에 오는 `!` 예외 규칙이 앞의 제외를 취소할 수 있기 때문에,
일부 패턴이 파일 중간에 있다는 사실만으로 설치가 끝났다고 판단하지 않습니다. 다시 실행할 때
끝 블록이 일치하고 개인 설정, 실제 작업 메모, 로그, `artifactsDir` 산출물이
`git check-ignore --no-index`에서 모두 제외되면 `.gitignore`를 `unchanged`로 처리합니다.

루트 `.gitignore`를 새로 만들 때는 보호 대상의 상위 디렉터리에 있는 `.gitignore`도
확인합니다. 여기에 `!`로 시작하는 예외 규칙이 있으면 파일을 쓰기 전에 중단하므로 직접
검토해야 합니다. 아직 없는 디렉터리에 어떤 예외가 적용될지는 Git 조회만으로 정확히 알기
어렵습니다. 따라서 보호 대상과 관계없어 보이는 예외가 있어도 안전을 위해 중단합니다.
다만 제외할 디렉터리 내부의 `.gitignore`는 부모의 제외를 취소할 수 없으므로 그 안의 예외는
중단 사유가 아닙니다. `.git/info/exclude`와 전역 규칙도 새 루트 규칙보다 우선순위가 낮아
사전 차단 대상에 포함하지 않습니다. 이 검사는 대표 경로만 확인하므로 앞으로 생길 모든
파일명이 제외된다고 보장하지는 않습니다.

다른 공유 파일에 프로젝트 내용을 합치면 패키지 원본과 달라지므로 계속 충돌할 수 있습니다.
가능하면 `CLAUDE.md`의 프로젝트 규칙은 설정의 `paths.conventions`가 가리키는 별도 문서로
옮기고, 개인 권한은 `.claude/settings.local.json`에 두세요. 같은 경로의 명령이나 스킬을
수정해야 한다면 manifest를 기준으로 필요한 파일을 직접 배치하고, init dry-run에서 해당
충돌을 해결되지 않은 차이로 관리해야 합니다. init은 사용자가 병합한 파일을 승인된 상태로
기록하거나 일부 파일만 골라 설치하지 않습니다.

같은 설정으로 설치를 다시 실행하면 모든 배포 파일이 `unchanged`가 되고 새 파일은 만들지
않습니다. 강제 덮어쓰기와 자동 롤백은 지원하지 않습니다.

## 실패와 복구

사전 검사를 통과한 뒤 권한이나 디스크 오류가 발생하면 init은 성공으로 처리하지 않습니다.
이미 만든 파일과 디렉터리, 실패한 파일, 아직 만들지 못한 파일을 결과에 남깁니다. 새 파일을
연 뒤 쓰기에 실패하면 `partial: true`로 표시될 수 있으므로 해당 파일의 내용을 반드시
확인하세요. 원인을 해결하고 부분 파일을 검토하거나 제거한 뒤 dry-run부터 다시 실행하세요.

| 종료 코드 | 의미 |
| --- | --- |
| `0` | 유효한 dry-run 또는 설치 완료 |
| `1` | 기존 파일 충돌로 전체 설치 중단 |
| `2` | 잘못된 입력, Git/경로 검사 오류 또는 파일 I/O 실패 |

`--json`을 사용하면 stdout에는 JSON 객체 하나만 출력됩니다. init 실행 결과는 `schemaVersion`,
`command`, `dryRun`, `root`, `status`, `templateVersion`, `config`, `files`,
`createdDirectories`, `errors`, `warnings`, `exitCode`를 포함합니다. `status`는 유효한
dry-run이면 `ready`, 설치를 마치면 `completed`, 충돌하면 `blocked`, 오류가 나면 `failed`입니다.
사람이 읽는 출력과 JSON은 같은 설치 계획, 충돌, 오류를 보여줍니다.
명령 구문 오류가 나면 `schemaVersion`, `command`, `status`, `errors`, `exitCode`를 반환합니다.
충돌을 해결하는 방법은 `files[].message`에서 확인할 수 있고, `errors`에는 설정/경로/I/O
오류가 들어갑니다. 도움말과 버전 출력은 각각 `status: help`와 `status: version`인 JSON으로
반환합니다.

## 경로와 보안 경계

manifest의 source와 target은 각각의 루트 안에 있는 일반 파일이어야 합니다. 절대 경로,
`..`, 중복 경로, 파일과 디렉터리 사이의 접두 경로 충돌, Windows에서 대소문자만 다른 경로는
거부합니다. 대상 경로에 이미 있는 심볼릭 링크와 Windows junction도 따라가지 않습니다.
`artifactsDir`가 파일이나 링크이거나 이미 추적 중인 소스를 포함해도 설치하지 않습니다.

이 검사는 설치를 시작할 때 확인한 파일 시스템 상태를 사용합니다. 다른 프로세스가 검사와
쓰기 사이에 경로나 파일을 악의적으로 바꾸는 상황까지 막는 보안 샌드박스는 아닙니다.
신뢰할 수 있는 로컬 저장소에서 실행하고, 공유 디렉터리에서는 설치가 끝날 때까지 다른 쓰기
작업을 멈추세요. Git을 조회하는 하위 프로세스 안에서만 저장소/인덱스/탐색 환경변수와 추적
로그 설정을 분리합니다. 사용자의 환경변수나 Git 설정 파일은 변경하지 않습니다. Trace2
설정도 로그를 만들 수 있으므로
[Git이 문서화한 비활성화 값](https://git-scm.com/docs/git#Documentation/git.txt-GITTRACE2)을 적용합니다.
Windows 예약 이름은 `CONIN$`, `CONOUT$`, `COM¹` 같은 장치 이름도 거부합니다.
기준은 [Windows 파일 이름 규칙](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#naming-conventions)과
[DOS 장치 이름 규칙](https://learn.microsoft.com/en-us/windows/win32/devnotes/rtlisdosdevicename_u#remarks)입니다.

중요한 저장소에 적용하기 전에는 폐기할 수 있는 격리 저장소에서 실제 파일 생성과 재실행을
확인하세요.

## 검증 기록

`npm run check`는 임시 Git 저장소에서 설치 계획, 충돌 시 파일 보존, 재설치, 경로 검사,
쓰기 실패 후의 결과 표시를 확인합니다. 공백과 한글 경로, Windows 8.3 별칭, 심볼릭 링크와
junction, Git 제외 규칙도 검사합니다. 이 테스트에는 Node와 Git만 필요하며 실제 Gradle이나
Claude Code 인증은 필요하지 않습니다.

전체 CI 결과는 [README의 검증 현황](../README.md#검증-현황)을 참고하세요.
