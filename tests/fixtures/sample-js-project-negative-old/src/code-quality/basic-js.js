/**
 * Code quality violations that only trigger in .js files (not .ts).
 */

// VIOLATION: code-quality/deterministic/no-var-declaration
function noVarDeclaration() {
  var x = 42;
  return x;
}

module.exports = { noVarDeclaration };
