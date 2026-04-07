/**
 * Basic code quality violations.
 */

// VIOLATION: code-quality/deterministic/console-log
export function consoleLogExample() {
  console.log('debug output');
  console.debug('more debug');
  return 42;
}

// VIOLATION: code-quality/deterministic/no-explicit-any
export function noExplicitAny(data: any): any {
  return data;
}

// VIOLATION: code-quality/deterministic/no-debugger
export function noDebuggerExample() {
  debugger;
  return true;
}

// VIOLATION: code-quality/deterministic/no-alert
export function noAlertExample() {
  alert('hello');
}

// no-var-declaration only fires for .js files — moved to basic-js.js

// VIOLATION: code-quality/deterministic/strict-equality
export function strictEqualityExample(a: number, b: number) {
  if (a == b) {
    return true;
  }
  if (a != b) {
    return false;
  }
  return null;
}

// VIOLATION: code-quality/deterministic/no-throw-literal
export function noThrowLiteral() {
  throw 'something went wrong';
}

// VIOLATION: code-quality/deterministic/no-script-url
export function noScriptUrl() {
  const link = 'javascript:void(0)';
  return link;
}

// VIOLATION: code-quality/deterministic/no-proto
export function noProto(obj: any) {
  return obj.__proto__;
}

// VIOLATION: code-quality/deterministic/no-void
export function noVoid() {
  return void someFunction();
}
function someFunction() { return 42; }
