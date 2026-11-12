# 시작 가이드

테스트할 Gradle 저장소에 dev-cycle을 설정하고, 테스트 결과를 보고서로 확인하는 방법입니다.

## 1. CLI 빌드

Node.js 22.17.0 이상 22 계열, npm 10 이상, Git을 준비하세요.
이 저장소를 clone한 디렉터리에서 실행합니다.

```sh
npm ci
npm run build
node /path/to/dev-cycle/dist/cli.js --help
```

`/path/to/dev-cycle`은 clone한 저장소의 실제 경로로 바꾸세요. 아래 명령에서도 같은 경로를
사용합니다. 경로에 공백이 있다면 전체를 따옴표로 감싸주세요.

## 2. 대상 저장소와 설정 준비

테스트할 저장소에는 JDK와 Gradle Wrapper가 준비되어 있어야 합니다. `settings.gradle`에
모듈 이름을 직접 선언한 프로젝트를 지원하며, Kotlin DSL이나 동적 모듈 설정은 지원하지 않습니다.
전체 조건은 [지원하는 프로젝트](test.md#지원하는-프로젝트)를 확인하세요.

[`설정 파일 예시`](../examples/dev-cycle.config.json)를 대상 저장소 밖의 새 파일로 복사하고,
다음 항목을 프로젝트에 맞게 수정하세요. 기존 설정 파일이 있다면 새로 덮어쓰지 말고 그 파일을 사용하세요.

| 항목 | 확인할 내용 |
| --- | --- |
| `repository` | `owner/repository` 형식의 저장소 이름 |
| `defaultBranch` | 프로젝트의 기본 브랜치 이름 |
| `baseRef` | 코드 변경을 비교할 ref. 로컬에서 읽을 수 있는 `main`, `origin/main`, `HEAD` 등을 지정합니다. |
| `paths` | 프로젝트 지침, 이슈 양식, PR 양식의 경로 |
| `commands.test` | Gradle Wrapper 경로와 인자. Windows용 설정이 있으면 그 실행 파일과 인자를 사용합니다. |
| `test` | 공통 모듈, 전체 테스트가 필요한 경로, 테스트를 생략할 수 있는 문서 경로 |
| `artifactsDir` | 실행 결과를 저장할 전용 디렉터리. 예시 값은 `.dev-cycle`입니다. |

예시의 `trunk`와 `origin/trunk`를 그대로 쓰기 전에 실제 저장소에 있는 ref인지 확인하세요.
CLI는 원격에서 ref를 가져오거나 기본 브랜치를 추측하지 않습니다. `test`를 실행하려면
HEAD 커밋도 있어야 합니다. 설정에 사용할 수 있는 값은 [설정 안내](workflow-package.md#manifest와-렌더링)를
참고하세요.

## 3. 설치할 파일 확인

아래의 `/path/to/project`는 테스트할 저장소 경로, `/path/to/project-config.json`은 준비한
설정 파일 경로로 바꾸세요.

```sh
node /path/to/dev-cycle/dist/cli.js init /path/to/project --config /path/to/project-config.json --dry-run
```

이 명령은 파일을 쓰지 않고 설치할 내용을 보여줍니다. 결과가 `ready`이면 다음 단계로
진행하세요. `blocked`나 `conflict`가 나오면 [충돌 처리](init.md#계획과-충돌)를 먼저 확인해야 합니다.
기존 파일을 덮어쓰거나 자동으로 합치는 옵션은 없습니다.

```sh
node /path/to/dev-cycle/dist/cli.js init /path/to/project --config /path/to/project-config.json
node /path/to/dev-cycle/dist/cli.js init /path/to/project
```

첫 번째 명령이 파일을 설치합니다. 두 번째 명령으로 다시 실행했을 때 설치된 파일이 모두
`unchanged`라면 기존 내용이 그대로 유지된 것입니다. 이후에는 대상 Git 루트에 설치된
`dev-cycle.config.json`을 읽으므로 `--config`를 생략할 수 있습니다.

`init`은 PATH에 `dev-cycle` 명령을 등록하지 않습니다. 이후에도 `node .../dist/cli.js`로
실행하세요. Claude Code의 `/test`나 PR 스킬을 쓸 때도 빌드한 CLI의 실제 경로를 알려줘야 합니다.
CLI 대신 Gradle을 직접 실행하면 dev-cycle 실행 기록은 남지 않아 `report`로 그 결과를 읽을 수 없습니다.

## 4. 테스트 실행

먼저 어떤 테스트가 선택되는지 확인하세요.

```sh
node /path/to/dev-cycle/dist/cli.js test /path/to/project --dry-run --json
```

JSON의 `selection.tasks`에 실행할 태스크가, `selection.reasons`에 선택 이유가 나옵니다.
예를 들어 공통 모듈이 아닌 `app`의 코드만 바뀌었다면 `:app:test`를 선택합니다. 공통 모듈이 바뀌었거나 변경의
영향을 판단할 수 없다면 전체 테스트를 선택합니다. 변경이 없거나 설정에 지정한 문서만
바뀌었다면 테스트를 생략합니다. 자세한 내용은 [선택 규칙](test.md#선택-규칙)을 참고하세요.

실제 테스트는 `--dry-run`을 빼고 실행합니다.

```sh
node /path/to/dev-cycle/dist/cli.js test /path/to/project
```

프로세스 종료 코드, 실행한 태스크, 이번 실행의 XML 테스트 수를 확인하세요.
`UP-TO-DATE`나 `FROM-CACHE`이면 테스트를 새로 실행한 것으로 집계하지 않습니다.
실패하거나 중단됐다면 원인을 해결한 뒤 다시 실행하세요. 이전 기록을 덮어쓰지 않고 새 기록을 만듭니다.

## 5. 보고서 확인과 저장

```sh
node /path/to/dev-cycle/dist/cli.js report /path/to/project
node /path/to/dev-cycle/dist/cli.js report /path/to/project --json
```

기본 출력은 PR 본문에 붙일 수 있는 Markdown입니다. `--json`을 쓰면 Markdown과 실행 기록,
현재 코드와의 비교 결과를 함께 읽을 수 있습니다. 최신 실행이 실패했거나 생략됐으면 그 상태를
그대로 보여줍니다.

`freshness`에서 테스트 당시 코드와 현재 코드가 같은지 확인하세요. `current`이면
기록 시점과 같고, `changed`이면 테스트 중이나 이후에 코드·설정 등이 바뀐 것입니다.
`unknown`이나 `incomplete`이면 현재 코드가 검증됐다고 볼 수 없습니다.

테스트를 통과한 뒤 코드를 고쳤다면 다시 테스트하고 보고서를 새로 만드세요.
`report`가 정상 종료했다는 사실만으로 테스트도 통과했다고 판단하면 안 됩니다.
상태별 의미는 [report 사용법](report.md#테스트-이후-코드-변경-확인)에 있습니다.

파일로 저장하려면 `--output`을 지정하세요. 아래 명령은 `artifactsDir`가 `.dev-cycle`일 때의 예시입니다.

```sh
node /path/to/dev-cycle/dist/cli.js report /path/to/project --output .dev-cycle/reports/pr-tests.md
```

보고서는 설정한 `artifactsDir` 아래의 `reports/`에만 저장할 수 있습니다. 기존 파일은
덮어쓰지 않으므로 같은 이름이 있다면 다른 파일명을 지정하세요. 파일을 저장하기 전에
확인하려면 `--dry-run`을 추가하면 됩니다.
