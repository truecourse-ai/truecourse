/**
 * Filename/class mismatch violation.
 * The file is named "wrong-name.ts" but default-exports a class called "CorrectName".
 */

// VIOLATION: code-quality/deterministic/filename-class-mismatch
export default class CorrectName {
  value = 42;
}
