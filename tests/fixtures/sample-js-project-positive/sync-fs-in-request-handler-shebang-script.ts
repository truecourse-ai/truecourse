#!/usr/bin/env node
// A file with a shebang is an executable script run directly (`node file`),
// not a server module on a request path. Synchronous filesystem calls in this
// dev-tooling utility block only the script's own short-lived process, never a
// shared event loop, so they are not the hazard this rule targets.

import { existsSync, mkdirSync } from 'fs';

declare function persistManifest(dir: string): Promise<void>;

export async function ensureSnapshotDir(outputDir: string): Promise<void> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  await persistManifest(outputDir);
}
