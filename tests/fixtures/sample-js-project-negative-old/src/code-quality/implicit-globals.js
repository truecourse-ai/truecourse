/**
 * JavaScript-only violations for implicit globals and global declarations.
 */

// VIOLATION: code-quality/deterministic/implicit-global
// (needsDataFlow — assignment to undeclared variable in JS creates implicit global)
function implicitGlobalViolation() {
  leakedGlobal = 42;
  return leakedGlobal;
}

// VIOLATION: code-quality/deterministic/implicit-global-declaration
// Top-level var in a non-module file pollutes global scope
var globalVarDeclaration = 'polluting';

// VIOLATION: code-quality/deterministic/implicit-global-declaration
// Top-level function declaration in a non-module (script) file
function globalFuncDeclaration() {
  return globalVarDeclaration;
}
