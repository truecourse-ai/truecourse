#!/usr/bin/env node

/**
 * Postinstall script for TrueCourse.
 *
 * On Node 24+, tree-sitter requires C++20 to compile but its binding.gyp
 * only specifies C++17. This script detects the failure and retries the
 * build with the correct flag.
 *
 * Logs are written to ~/.truecourse/install.log for debugging.
 *
 * See: https://github.com/truecourse-ai/truecourse/issues/22
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const logDir = path.join(os.homedir(), '.truecourse');
const logFile = path.join(logDir, 'install.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, line + '\n');
  } catch {
    // best effort
  }
  console.log(`[TrueCourse] ${msg}`);
}

log('--- postinstall started ---');
log(`Node ${process.version}, platform=${process.platform}, arch=${process.arch}`);
log(`CXXFLAGS=${process.env.CXXFLAGS || '(not set)'}`);

try {
  require('tree-sitter');
  log('tree-sitter: loaded OK');
} catch (err) {
  log(`tree-sitter: failed to load — ${err.message}`);

  const { execSync } = require('child_process');
  const packages = [
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-javascript',
    'tree-sitter-python',
  ].join(' ');

  log('Rebuilding with CXXFLAGS="-std=c++20"...');

  try {
    execSync(`CXXFLAGS="-std=c++20" npm rebuild ${packages}`, {
      stdio: 'inherit',
      env: { ...process.env, CXXFLAGS: '-std=c++20' },
    });
    log('tree-sitter: rebuilt OK');
  } catch {
    log('tree-sitter: rebuild failed');
    console.warn(
      '\n[TrueCourse] Could not rebuild tree-sitter automatically.\n' +
      'Fix: set the C++20 flag manually and reinstall:\n' +
      '  export CXXFLAGS="-std=c++20"\n' +
      '  npx truecourse\n\n' +
      'See: https://github.com/truecourse-ai/truecourse/issues/22\n'
    );
    process.exit(0);
  }
}

log('--- postinstall done ---');
