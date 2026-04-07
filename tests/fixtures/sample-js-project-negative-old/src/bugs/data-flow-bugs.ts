/**
 * Bug violations that require data flow analysis.
 */

// VIOLATION: bugs/deterministic/use-before-define
// Variable used before its declaration (temporal dead zone for let/const)
export function useBeforeDefine() {
  const result = counter + 1;
  const counter = 10;
  return result;
}
