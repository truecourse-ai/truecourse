declare function require(id: string): unknown;

// VIOLATION: code-quality/deterministic/require-import
const helper = require('./helper');

export function loadHelper(): unknown {
  return helper;
}
