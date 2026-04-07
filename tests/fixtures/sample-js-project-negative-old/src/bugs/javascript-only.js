/**
 * Bug violations that only apply to JavaScript files (not TypeScript).
 */

// VIOLATION: bugs/deterministic/no-undef
// Reference to undeclared variable — will throw ReferenceError at runtime
function noUndefExample() {
  return undeclaredVariable + 1;
}

module.exports = { noUndefExample };
