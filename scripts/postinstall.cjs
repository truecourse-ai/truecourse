#!/usr/bin/env node

/**
 * Postinstall script for TrueCourse.
 *
 * On Node 24+, tree-sitter requires C++20 to compile but its binding.gyp
 * only specifies C++17. This script detects the failure and retries the
 * build with the correct flag.
 *
 * See: https://github.com/truecourse-ai/truecourse/issues/22
 */

try {
  require('tree-sitter');
} catch {
  const { execSync } = require('child_process');
  const packages = [
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-javascript',
    'tree-sitter-python',
  ].join(' ');

  console.log('[TrueCourse] tree-sitter native module not found, rebuilding with C++20...');

  try {
    execSync(`CXXFLAGS="-std=c++20" npm rebuild ${packages}`, {
      stdio: 'inherit',
      env: { ...process.env, CXXFLAGS: '-std=c++20' },
    });
    console.log('[TrueCourse] tree-sitter rebuilt successfully.');
  } catch {
    console.warn(
      '\n[TrueCourse] Could not rebuild tree-sitter automatically.\n' +
      'Fix: set the C++20 flag manually and reinstall:\n' +
      '  export CXXFLAGS="-std=c++20"\n' +
      '  npx truecourse\n\n' +
      'See: https://github.com/truecourse-ai/truecourse/issues/22\n'
    );
    // Exit 0 — don't fail the install
    process.exit(0);
  }
}
