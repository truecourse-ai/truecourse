import { spawnSync } from 'node:child_process';

export function isCliBinaryAvailable(binary: string): boolean {
  // Windows needs `shell: true` so cmd.exe applies PATHEXT (resolving `.cmd`
  // shims) and so the CVE-2024-27980 mitigation — which rejects direct spawn
  // of `.cmd`/`.bat` — doesn't fire when CLAUDE_CODE_BINARY points at one.
  const result = spawnSync(binary, ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
    timeout: 5_000,
  });
  return result.status === 0;
}
