#!/usr/bin/env node

/**
 * Postinstall script for TrueCourse.
 *
 * On Node 24+, tree-sitter requires C++20 to compile but its binding.gyp
 * only specifies C++17. When the optional tree-sitter deps fail to install,
 * this script reinstalls them with the correct compiler flag.
 *
 * Logs are written to ~/.truecourse/logs/install.log for debugging.
 *
 * See: https://github.com/truecourse-ai/truecourse/issues/22
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const logDir = path.join(os.homedir(), '.truecourse', 'logs');
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

  // The optional-dep install already extracted tree-sitter's source into
  // node_modules/tree-sitter/ — only its native .node binary failed to build
  // (Node 24 needs C++20, default is C++17). `npm rebuild` runs the build
  // scripts on the existing install with our CXXFLAGS, leaving manifests
  // untouched so the install survives later `npm exec` integrity passes
  // that would prune an `npm install --no-save` addition as extraneous.
  const packages = ['tree-sitter', 'tree-sitter-typescript', 'tree-sitter-javascript', 'tree-sitter-python'];

  log('Rebuilding tree-sitter with CXXFLAGS="-std=c++20"...');

  try {
    execSync(`npm rebuild ${packages.join(' ')}`, {
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
