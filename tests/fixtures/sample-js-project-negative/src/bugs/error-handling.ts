/**
 * Bug violations related to error handling patterns.
 */

// VIOLATION: bugs/deterministic/empty-catch
export function emptyCatchExample() {
  try {
    JSON.parse('invalid');
  } catch (e) {
  }
}

// VIOLATION: bugs/deterministic/unsafe-finally
export function unsafeFinallyExample() {
  try {
    return 1;
  } catch (e) {
    return 2;
  } finally {
    return 3;
  }
}

// VIOLATION: bugs/deterministic/exception-reassignment
export function exceptionReassignmentExample() {
  try {
    throw new Error('original');
  } catch (err) {
    err = new Error('replaced');
    throw err;
  }
}

// VIOLATION: bugs/deterministic/lost-error-context
export function lostErrorContextExample() {
  try {
    throw new Error('original');
  } catch (e) {
    throw new Error('something went wrong');
  }
}

// VIOLATION: bugs/deterministic/nested-try-catch
export function nestedTryCatchExample() {
  try {
    JSON.parse('{}');
  } catch (outer) {
    try {
      JSON.parse('fallback');
    } catch (inner) {
      const x = 1;
    }
  }
}

// VIOLATION: bugs/deterministic/error-type-any
export function errorTypeAnyExample() {
  try {
    throw new Error('test');
  } catch (e: any) {
    console.error(e.message);
  }
}
