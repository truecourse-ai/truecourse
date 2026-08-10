// Fresh negative case: bare-identifier `exec(...)` call where `exec` is
// imported from `child_process` via an ESM named import. This is a real
// command injection if the input is attacker-controlled.

import { exec } from 'child_process';

// VIOLATION: security/deterministic/os-command-injection
export function runLs(target: string): void {
  exec(`ls ${target}`, (err) => {
    if (err) {
      throw err;
    }
  });
}
