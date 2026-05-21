/**
 * Negative fixture for performance/deterministic/sync-fs-in-request-handler.
 *
 * Sync filesystem call inside a regular async handler — outside any
 * seed-script path. This is the bug pattern: it blocks the event loop
 * while serving a request.
 */

import fs from 'node:fs';

// VIOLATION: performance/deterministic/sync-fs-in-request-handler
export async function serveTemplate(templatePath: string): Promise<string> {
  const buffer = fs.readFileSync(templatePath);
  return buffer.toString('utf-8');
}
