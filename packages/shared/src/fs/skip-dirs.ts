/**
 * Build / vendor / tooling directories that document discovery skips when
 * walking a repo. The single source of truth shared by the spec scanner
 * (`discoverDocs` in @truecourse/spec-consolidator) and the EE github-app's PR
 * spec-detect, so the two agree on what counts as a discoverable spec document.
 */
export const DOC_DISCOVERY_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.truecourse', // TrueCourse's own outputs — never re-discover
  '.cache',
  'coverage',
]);
