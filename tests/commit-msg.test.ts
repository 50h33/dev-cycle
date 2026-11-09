import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

function validate(message: string): number | null {
  const directory = mkdtempSync(join(tmpdir(), 'dev-cycle-commit-'));
  try {
    const messageFile = join(directory, 'COMMIT_EDITMSG');
    writeFileSync(messageFile, message);
    const result = spawnSync(
      'git',
      ['-c', 'core.hooksPath=.githooks', 'hook', 'run', 'commit-msg', '--', messageFile],
      { cwd: root, encoding: 'utf8' },
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result.status;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const type of ['Feat', 'Fix', 'Docs', 'Refactor', 'Test', 'Chore', 'Infra']) {
  test(`${type} 타입과 이슈 번호가 있는 메시지를 허용한다`, () => {
    assert.equal(validate(`[${type}] #1 개발 환경 구성\n`), 0);
  });
}

for (const message of [
  '[Chore] #12 Windows 줄바꿈\r\n\r\n본문',
  '[Fix] #123 마지막 줄바꿈 없음',
  'Merge branch \'chore/1\'',
  'Revert "이전 커밋"',
  'fixup! [Chore] #1 설정 보완',
  'squash! [Chore] #1 설정 보완',
]) {
  test(`유효한 메시지 또는 Git 예외를 허용한다: ${message.split('\n')[0]}`, () => {
    assert.equal(validate(message), 0);
  });
}

for (const message of [
  '',
  'chore: 개발 환경 구성',
  '[Unknown] #1 잘못된 타입',
  '[chore] #1 잘못된 대소문자',
  '[Chore] 개발 환경 구성',
  '[Chore] #0 잘못된 이슈 번호',
  '[Chore] #1',
  '[Chore] #1   ',
  '[Chore] #1\n본문으로 요약을 대체할 수 없음',
  '\n[Chore] #1 첫 줄이 아님',
]) {
  test(`잘못된 메시지를 거부한다: ${JSON.stringify(message)}`, () => {
    assert.equal(validate(message), 1);
  });
}
