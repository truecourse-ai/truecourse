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

// Per-request handler — read on every call blocks the event loop.
async function handleAvatarRequest(userId: string): Promise<Buffer> {
  // VIOLATION: performance/deterministic/sync-fs-in-request-handler
  return fs.readFileSync(`/var/data/avatars/${userId}.png`);
}
void handleAvatarRequest;
