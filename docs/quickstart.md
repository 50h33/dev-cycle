# 최소 Gradle 프로젝트로 따라 하기

별도 Git 저장소에서 설정 준비 → CLI 빌드 → 설치 계획/충돌 확인 → 실제 Gradle 테스트 →
보고서와 코드 변경 감지까지 재현한다. dev-cycle 소스나 TicketRush 원본에서 예제를 실행하지 않는다.
명령별 계약은 [init](init.md), [test](test.md), [report](report.md)를 참고한다.

## 준비 조건

- Git, Node.js 22.17.0 이상 22 계열, npm 10 이상.
- JDK 21과 Gradle 9.3.0 배포본. `java -version`으로 JDK를 확인하고 `JAVA_HOME`도 같은 JDK를 가리키게 한다.
- 처음 실행할 때 Gradle 배포 서버와 Maven Central에 접근할 수 있어야 한다.
  이 예시는 `--offline`을 사용하지 않는다. 캐시가 없는 환경에서는 다운로드 시간이 추가된다.
- 아래 명령은 Windows PowerShell 기준이다. 실제 검증 버전은 이 문서 마지막에 기록한다.
  경로에 공백/한글은 허용되지만 [Windows 실행 제한 문자](test.md#windows와-명령-경계)는 피한다.

Gradle은 [공식 설치 안내](https://docs.gradle.org/9.3.0/userguide/installation.html)에 따라 준비한다.
[Wrapper 생성](https://docs.gradle.org/9.3.0/userguide/gradle_wrapper.html) 단계에서만 설치된 Gradle을
직접 호출하며 이후 CLI는 생성된 Wrapper를 사용한다. [Java 호환 범위](https://docs.gradle.org/9.3.0/userguide/compatibility.html)와
[JUnit 6.0.3 설정](https://docs.junit.org/6.0.3/running-tests/build-support.html)을 따른 예제다.
Claude Code 인증이나 GitHub 원격 저장소는 이 CLI 실습에 필요 없다.

## 1. 소스 빌드와 별도 작업 디렉터리 준비

dev-cycle을 clone한 절대 경로와 Gradle 실행 파일 경로를 자신의 설치 위치로 바꾼다.
`$project`는 아직 없는 디렉터리여야 하며, 이후 명령은 같은 PowerShell 세션에서 순서대로 실행한다.
각 명령이 실패하면 오류를 해결한 뒤 해당 단계부터 진행한다.

```powershell
$devCycle = 'C:\work\dev-cycle'
$gradle = 'C:\tools\gradle-9.3.0\bin\gradle.bat'
$project = Join-Path ([System.IO.Path]::GetTempPath()) ('dev-cycle demo ' + [guid]::NewGuid())

Set-Location $devCycle
npm ci
npm run build
$cli = Join-Path $devCycle 'dist/cli.js'
node $cli --version

New-Item -ItemType Directory -Path $project -ErrorAction Stop | Out-Null
Get-ChildItem -LiteralPath (Join-Path $devCycle 'examples/minimal-gradle') -Force |
    Copy-Item -Destination $project -Recurse
Set-Location $project
git init -b main
& $gradle :wrapper --gradle-version 9.3.0 --distribution-type bin --no-daemon
```

[`examples/minimal-gradle/`](../examples/minimal-gradle/)에는 정적 `include 'app'` 설정,
Java 소스와 JUnit 테스트 한 개, 프로젝트 설정과 `.gitignore`가 있다. Wrapper는 위 명령으로
새 디렉터리에 생성한다. 기존 설치본이나 전역 `dev-cycle` 명령에 의존하지 않는다.

`dev-cycle.config.json`의 `repository: example/dev-cycle-demo`는 실습용 식별자이며 원격 조회나
생성을 유발하지 않는다. 비교 기준은 곧 만들 로컬 `main` 커밋이다. 실제 프로젝트에 적용할 때는
저장소명, 기준 ref와 경로를 직접 바꾼다. 다른 브랜치를 사용하는 설정 예시는
[`examples/dev-cycle.config.json`](../examples/dev-cycle.config.json), 전체 필드 설명은
[설정 계약](workflow-package.md#manifest와-렌더링)을 참고한다.

## 2. 설치 계획과 충돌 확인

```powershell
node $cli init $project --dry-run
node $cli init $project
node $cli init $project
```

처음 계획은 `ready`, 설치는 `completed`가 되어야 한다. 예제에 이미 준비한 설정과 `.gitignore`는
`unchanged`이고 나머지 17개 파일을 생성한다. 마지막 재실행에서는 전체 19개 파일이 `unchanged`다.
이 실습에는 프로젝트 지침과 GitHub 양식을 넣지 않았으므로 해당 경로가 없다는 경고가 나온다.
CLI 실습을 막는 오류는 아니며 Claude Code로 실제 이슈/PR 작업을 할 때 별도로 준비한다.

`init`은 템플릿을 설치하며 PATH에 `dev-cycle` 명령을 등록하지 않는다. 설치 후 Claude Code의
`/test`나 PR 스킬을 사용한다면 `node /absolute/path/to/dev-cycle/dist/cli.js`의 실제 경로도
알려준다. 이 문서의 `$cli`는 현재 PowerShell 세션의 변수이므로 다른 세션에 자동 전달되지 않는다.
템플릿이 CLI를 찾지 못해 Gradle 직접 실행 절차를 사용하면 CLI 실행 기록과 `report` 증거는
생성되지 않는다. 아래 실습은 같은 세션의 `node $cli`로 기록까지 확인한다.

`blocked` 또는 `conflict`가 나오면 실제 설치로 넘어가지 말고 [충돌 처리](init.md#계획과-충돌)를
따른다. 예제 `.gitignore`는 Gradle 제외 규칙 뒤에 설치 템플릿의 전체 블록을 둔 상태다.
기존 프로젝트에서도 그 블록을 파일 끝에 추가해야 기존 규칙을 보존하면서 설치할 수 있다.

설치가 끝나면 비교할 기준 커밋을 만들고 작업 브랜치에서 테스트할 변경을 준비한다.
아래 `-c` 이름/이메일은 실습 커밋 한 번에만 적용하며 Git 사용자 설정을 바꾸지 않는다.

```powershell
git add .
git -c user.name='Demo' -c user.email='demo@example.test' commit -m 'Prepare demo baseline'
git switch -c demo/test
Add-Content -LiteralPath 'app/src/main/java/example/Calculator.java' -Value '// before test' -Encoding ascii
```

기준 커밋 없이 `test`를 실행하면 분석 오류이고, 기준과 동일한 상태면 변경이 없어 생략된다.
이 예제는 `app` 소스만 변경해 `:app:test` 선택을 관찰한다.

## 3. 실제 테스트와 보고서

```powershell
node $cli test $project --dry-run --json
node $cli test $project
node $cli report $project
node $cli report $project --output .dev-cycle/reports/success.md
```

dry-run에서 `selection.tasks`가 `[":app:test"]`인지 확인한다. dry-run 자체는 `not-run`이며
실행 기록을 만들지 않는다. 실제 실행은 Gradle의 표준 test 태스크로 JUnit assertion을 실행한다.
보고서는 기본 stdout에 출력하며 마지막 명령으로 관리 디렉터리에만 저장한다.
`success.md`가 이미 있으면 덮어쓰지 않으므로 새 파일명을 사용한다.

## 4. 테스트 후 변경을 구별하기

테스트를 다시 실행하지 않고 같은 소스에 주석을 추가한다.

```powershell
Add-Content -LiteralPath 'app/src/main/java/example/Calculator.java' -Value '// after test' -Encoding ascii
node $cli report $project
```

이제 보고서의 과거 테스트 상태는 `succeeded`로 남지만 신선도는 `changed`가 된다.
이는 테스트 실패가 아니라 현재 코드가 기록 시점과 달라졌다는 뜻이다. 주석 변경도 코드 지문에
포함된다. `report`의 종료 코드 0은 보고서 생성 성공이며 현재 코드의 테스트 통과를 뜻하지 않는다.

현재 코드를 검증하려면 `node $cli test $project`를 다시 실행하고 새 보고서를 확인한다.
Gradle이 `UP-TO-DATE`로 판단하면 새 테스트 수는 확인되지 않으므로 새 통과 1개라고 쓰지 않는다.
강제 재실행이 필요하면 [허용 옵션](test.md#지원하는-프로젝트)에 따라 설정의 일반/Windows
`args` 양쪽에 `--rerun-tasks`를 추가한 뒤 다시 실행한다.

## 실측 출력과 검증 범위

2026-11-11, `431cbb5` 기반 문서 작업 트리(src 변경 없음)의 소스 빌드로 위 예제를 실행했다.
환경은 Windows / Node.js 22.17.0 / npm 10.9.2 / Java 21.0.6 / Gradle 9.3.0 / JUnit 6.0.3이다.
이미 있는 Gradle 배포본·의존성 캐시를 사용하되 `--offline`은 지정하지 않았다.
캐시가 없는 환경의 최초 다운로드와 Ubuntu에서의 이 예제 실행은 이번 검증에 포함하지 않았다.

실제 `test` stdout에서 관련 줄만 발췌했다. 개인 경로, 실행 인자, run ID와 기타 태스크 로그는 생략했다.

```text
dev-cycle test: succeeded
선택: modules (app)
프로세스 종료 코드: 0, signal: 없음
  :app:test: EXECUTED
이번 실행 XML: tests=1, failures=0, errors=0, skipped=0
실행 전후 코드: unchanged
```

같은 실행의 `report` Markdown 발췌다. JSON으로도 `run.status: succeeded`,
`freshness.status: current`, XML 합계 1개/실패 0개를 확인했다. 파일로 저장한 뒤에도 `current`였다.

```markdown
- 테스트 상태: succeeded
- 코드 신선도: current: 기록한 코드와 설정 지문이 현재 상태와 같습니다\.
- 이번 실행 XML: tests=1, failures=0, errors=0, skipped=0
```

4단계의 주석 추가 후, 동일 run ID를 선택한 보고서의 발췌다. JSON의 `run.status`는 그대로이며
`freshness.status`만 `changed`가 됐다. Markdown 출력의 `\.`는 생성기가 넣는 escape다.

```markdown
- 테스트 상태: succeeded
- 코드 신선도: changed: 테스트 이후 코드, 설정 또는 비교 ref가 변경되었습니다\.
- **현재 코드를 검증하지 않았습니다. 과거 또는 불안정한 실행 결과입니다.**
```

설치 계획 `ready`, 신규 17개/기존 유지 2개, 재설치 전체 19개 `unchanged`도 확인했다.
실제 테스트 증거는 대상 저장소의 `.dev-cycle/runs/<run-id>/record.json`과 `evidence/`에,
저장한 보고서는 `.dev-cycle/reports/success.md`에 남는다. 실행마다 UUID와 지문은 달라진다.
이는 최소 프로젝트의 실제 Gradle 결과이며 CLI 자체의 [Windows/Ubuntu CI](../README.md#최신-main의-cli-ci),
TicketRush 서비스 통합 테스트나 Claude Code 모델 실행 결과와는 별개다.

문서 작업의 최종 로컬 검증은 2026-11-12에 완료를 확인했다. 같은 Windows / Node.js 22.17.0 /
npm 10.9.2 환경에서 `npm run check`가 종료 코드 0으로 끝났고, lint·타입 검사·빌드와 테스트
162개 중 159개 통과, POSIX 전용 3개 생략, 실패 0개를 확인했다. 문서 내부 링크·앵커 52개,
설정 예시, 위 출력 발췌 3개와 실제 로그의 일치, `git diff --check`도 통과했다.
