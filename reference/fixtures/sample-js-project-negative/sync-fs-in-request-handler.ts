// A synchronous filesystem read inside an ordinary async handler module (no
// shebang, not a script directory). This blocks the shared event loop on every
// invocation — the real performance bug the rule is meant to catch.

import { readFileSync } from 'fs';

export async function loadReport(reportPath: string): Promise<string> {
  // VIOLATION: performance/deterministic/sync-fs-in-request-handler
  const contents = readFileSync(reportPath, 'utf-8');
  return contents.trim();
}
