// VIOLATION: architecture/deterministic/god-module
/**
 * Miscellaneous code quality violations — covering remaining rules.
 */

declare function confirm(message: string): boolean;

// VIOLATION: code-quality/deterministic/alert-usage
export function confirmDialog() {
  confirm('Are you sure?');
}

// VIOLATION: code-quality/deterministic/async-promise-function
export function promiseInstead() {
  return new Promise((resolve) => {
    resolve(42);
  });
}

// VIOLATION: code-quality/deterministic/boolean-parameter-default
export function optionalVerbose(verbose?: boolean): void {
  if (verbose) {
    console.log('verbose mode');
  }
}

// VIOLATION: code-quality/deterministic/case-without-break
export function caseNoBreak(x: number) {
  let result = '';
  switch (x) {
    case 1:
      result = 'one';
    case 2:
      result = 'two';
      break;
  }
  return result;
}

// VIOLATION: code-quality/deterministic/debugger-statement
export function debugHere() {
  debugger;
  return true;
}

// VIOLATION: code-quality/deterministic/default-case-in-switch
export function noDefault(action: string) {
  switch (action) {
    case 'start':
      return 'starting';
    case 'stop':
      return 'stopping';
  }
}

// VIOLATION: code-quality/deterministic/dot-notation-enforcement
export function bracketAccess(obj: Record<string, any>) {
  return obj['name'];
}

// VIOLATION: code-quality/deterministic/empty-function
export function noOp() {
}

// VIOLATION: architecture/deterministic/too-many-parameters
// VIOLATION: code-quality/deterministic/expression-complexity
export function complexExpr(a: number, b: number, c: number, d: number, e: number, f: number, g: number) {
  return a + b * c - d / e + f * g - a + b;
}

// VIOLATION: code-quality/deterministic/function-in-block
export function innerFunctionDecl(condition: boolean) {
  if (condition) {
    function innerHelper() {
      return 42;
    }
    return innerHelper();
  }
  return 0;
}

// VIOLATION: code-quality/deterministic/global-statement
export function varDeclaration() {
  var localVar = 42;
  return localVar;
}

// VIOLATION: code-quality/deterministic/hardcoded-port
export function getPort() {
  const port = 8080;
  return port;
}

// VIOLATION: code-quality/deterministic/identical-functions
export function identicalA(x: number) {
  const result = x * 2 + 10;
  return result;
}
export function identicalB(x: number) {
  const result = x * 2 + 10;
  return result;
}

// VIOLATION: code-quality/deterministic/inconsistent-function-call
class Widget {}
export function inconsistentNew() {
  const a = new Widget();
  const b = Widget();
  return { a, b };
}

// VIOLATION: code-quality/deterministic/inferrable-types
export const typedString: string = 'hello';

// VIOLATION: code-quality/deterministic/interface-over-function-type
export interface Comparator {
  (a: number, b: number): number;
}

// VIOLATION: code-quality/deterministic/magic-string
export function mimeTypes() {
  const a = 'application/json';
  const b = 'application/json';
  const c = 'application/json';
  return [a, b, c];
}

// VIOLATION: code-quality/deterministic/meaningless-void-operator
export function voidUndefined() {
  const result = void 0;
  return result;
}

// VIOLATION: code-quality/deterministic/missing-destructuring
export function noDestructure(config: { timeout: number; retries: number }) {
  const timeout = config.timeout;
  const retries = config.retries;
  return timeout + retries;
}

// VIOLATION: code-quality/deterministic/missing-env-validation
export function rawEnv() {
  const dbUrl = process.env.DATABASE_URL;
  return dbUrl;
}

// VIOLATION: code-quality/deterministic/nested-template-literal
export function nestedTemplate(name: string, greeting: string) {
  return `Hello, ${`${greeting} ${name}`}!`;
}

// VIOLATION: code-quality/deterministic/prefer-object-literal
export function buildObject() {
  const obj = {};
  obj.name = 'Alice';
  obj.age = 30;
  return obj;
}

// VIOLATION: code-quality/deterministic/primitive-wrapper
export function wrapPrimitive() {
  return new String('hello');
}

// VIOLATION: code-quality/deterministic/symbol-description
export function noDescription() {
  return Symbol();
}

// VIOLATION: code-quality/deterministic/this-aliasing
export class Aliaser {
  value = 42;
  getHandler() {
    const self = this;
    return function() {
      return self.value;
    };
  }
}

// VIOLATION: code-quality/deterministic/undef-init
export function initUndefined() {
  let x = undefined;
  x = 42;
  return x;
}

// VIOLATION: code-quality/deterministic/undefined-assignment
export function assignUndefined() {
  let x = 10;
  x = undefined;
  return x;
}

// VIOLATION: code-quality/deterministic/undefined-passed-as-optional
export function optionalParam(a: number, b?: string) {
  return a;
}
export function callOptional() {
  return optionalParam(1, undefined);
}

// VIOLATION: code-quality/deterministic/unnecessary-boolean-compare
export function boolCompare(flag: boolean) {
  if (flag == true) {
    return 'yes';
  }
  return 'no';
}

// VIOLATION: code-quality/deterministic/unnecessary-label
export function unusedLabel() {
  myLabel:
  for (let i = 0; i < 10; i++) {
    if (i === 5) break;
  }
}

// VIOLATION: code-quality/deterministic/deprecated-api-usage
/** @deprecated Use newHelper instead */
function oldHelper() {
  return 42;
}
export function callDeprecated() {
  return oldHelper();
}

// VIOLATION: code-quality/deterministic/ungrouped-shorthand-properties
export function shorthandMix() {
  const name = 'Alice';
  const age = 30;
  const city = 'NYC';
  const country = 'US';
  return { name, title: 'Dr.', age, address: '123 St', city, zip: '10001', country };
}

// VIOLATION: code-quality/deterministic/selector-parameter
export function flagParam(isVerbose: boolean) {
  if (isVerbose) {
    return 'detailed output';
  }
  return 'short output';
}

// VIOLATION: code-quality/deterministic/require-unicode-regexp
export const noUnicode = /hello/;

// VIOLATION: code-quality/deterministic/regex-complexity
export const complexRegex = /(?=abc)(?!def)(group1)(group2)(group3)(group4)(group5)/;

// VIOLATION: code-quality/deterministic/regex-concise
export const shorthand = /[0-9]+/;

// VIOLATION: code-quality/deterministic/regex-unused-group
export function unusedGroup(text: string) {
  const pattern = /(?<year>\d{4})-(?<month>\d{2})/;
  return pattern.test(text);
}

// VIOLATION: code-quality/deterministic/regex-empty-after-reluctant
export const reluctant = /a*?b?/;

// VIOLATION: code-quality/deterministic/restricted-api-usage
export function defineGetter(obj: any) {
  return obj.__defineGetter__('prop', () => 42);
}

// VIOLATION: code-quality/deterministic/undefined-as-identifier
export function redefineUndefined() {
  let undefined = 'oops';
  return undefined;
}

// VIOLATION: code-quality/deterministic/variable-shadowing
const shadowedVar = 'outer';
export function shadowInner() {
  const shadowedVar = 'inner';
  return shadowedVar;
}

// VIOLATION: code-quality/deterministic/block-scoped-var
export function varLeak(condition: boolean) {
  if (condition) {
    var leakedVar = 42;
  }
  return leakedVar;
}
