/**
 * Build / vendor / tooling directories that document discovery skips when
 * walking a repo. The single source of truth shared by document discovery
 * (`discoverDocs`), the agent's repo tools and the route-manifest walk, so they
 * agree on what counts as discoverable.
 */

import { WORK_TREE_DIR } from './work-tree.js';

export const DOC_DISCOVERY_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  WORK_TREE_DIR, // a run's own working tree — never re-discover
  '.cache',
  'coverage',
  'vendor', // vendored third-party code — the docs promise it is never read
]);
