import { sync as spawnSync } from 'cross-spawn';

export function isCliBinaryAvailable(binary: string): boolean {
  // cross-spawn resolves Windows `.cmd`/`.ps1` shims to their underlying
  // executable directly, sidestepping both the CVE-2024-27980 spawn
  // restriction and the DEP0190 deprecation that fires when shell:true is
  // combined with an args array.
  const result = spawnSync(binary, ['--version'], {
    stdio: 'ignore',
    timeout: 5_000,
  });
  return result.status === 0;
}
