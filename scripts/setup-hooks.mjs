import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
chmodSync(new URL('../.githooks/commit-msg', import.meta.url), 0o755);
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
});
