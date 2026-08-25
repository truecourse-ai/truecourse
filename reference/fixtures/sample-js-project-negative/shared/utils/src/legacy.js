/**
 * Legacy JavaScript code — demonstrates JS-specific violations.
 */

// VIOLATION: code-quality/deterministic/no-var-declaration
var config = {};

// VIOLATION: code-quality/deterministic/implicit-global-declaration
function legacyInit() {
  globalData = { initialized: true };
  return globalData;
}

// VIOLATION: code-quality/deterministic/implicit-global
function setGlobal() {
  undeclaredVar = 42;
}

// VIOLATION: bugs/deterministic/no-undef
function useUndefined() {
  return undeclaredFunction();
}

module.exports = { config, legacyInit, setGlobal, useUndefined };
