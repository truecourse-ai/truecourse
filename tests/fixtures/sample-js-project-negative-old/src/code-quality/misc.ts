/**
 * Miscellaneous code quality violations covering rules not in other fixture files.
 */

// VIOLATION: code-quality/deterministic/alert-usage
export function alertUsageViolation() {
  confirm('Are you sure?');
}

// VIOLATION: code-quality/deterministic/async-promise-function
export function asyncPromiseViolation() {
  return new Promise((resolve) => {
    resolve(42);
  });
}

// VIOLATION: code-quality/deterministic/boolean-parameter-default
export function booleanParamDefault(verbose?: boolean): void {
  if (verbose) {
    console.log('verbose mode');
  }
}

// VIOLATION: code-quality/deterministic/case-without-break
export function caseWithoutBreakViolation(x: number) {
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
export function debuggerViolation() {
  debugger;
  return true;
}

// VIOLATION: code-quality/deterministic/default-case-in-switch
export function defaultCaseInSwitchViolation(action: string) {
  switch (action) {
    case 'start':
      return 'starting';
    case 'stop':
      return 'stopping';
  }
}

// VIOLATION: code-quality/deterministic/dot-notation-enforcement
export function dotNotationViolation(obj: Record<string, any>) {
  return obj['name'];
}

// VIOLATION: code-quality/deterministic/empty-function
export function emptyFunctionViolation() {
}

// VIOLATION: code-quality/deterministic/env-in-library-code
export function envInLibraryViolation() {
  const dbHost = process.env;
}

// VIOLATION: code-quality/deterministic/expression-complexity
export function expressionComplexityViolation(a: number, b: number, c: number, d: number, e: number, f: number, g: number) {
  return a + b * c - d / e + f * g - a + b;
}

// VIOLATION: code-quality/deterministic/function-in-block
export function functionInBlockViolation(condition: boolean) {
  if (condition) {
    function innerHelper() {
      return 42;
    }
    return innerHelper();
  }
  return 0;
}

// VIOLATION: code-quality/deterministic/global-statement
export function globalStatementViolation() {
  var localVar = 42;
  return localVar;
}

// VIOLATION: code-quality/deterministic/hardcoded-port
export function hardcodedPortViolation() {
  const port = 8080;
  return port;
}

// VIOLATION: code-quality/deterministic/identical-functions
export function identicalFuncA(x: number) {
  const result = x * 2 + 10;
  return result;
}
export function identicalFuncB(x: number) {
  const result = x * 2 + 10;
  return result;
}

// VIOLATION: code-quality/deterministic/inconsistent-function-call
class Widget {}
export function inconsistentCallViolation() {
  const a = new Widget();
  const b = Widget();
  return { a, b };
}

// VIOLATION: code-quality/deterministic/inferrable-types
export const inferrableViolation: string = 'hello';

// VIOLATION: code-quality/deterministic/interface-over-function-type
export interface Comparator {
  (a: number, b: number): number;
}

// VIOLATION: code-quality/deterministic/internal-api-usage
import { something } from 'lodash/internal/baseClone';

// VIOLATION: code-quality/deterministic/magic-number
export function magicNumberViolation(value: number) {
  return value * 42;
}

// VIOLATION: code-quality/deterministic/magic-string
export function magicStringViolation() {
  const a = 'application/json';
  const b = 'application/json';
  const c = 'application/json';
  return [a, b, c];
}

// VIOLATION: code-quality/deterministic/meaningless-void-operator
export function meaninglessVoidViolation() {
  const result = void 0;
  return result;
}

// VIOLATION: code-quality/deterministic/missing-destructuring
export function missingDestructuringViolation(config: { timeout: number }) {
  const timeout = config.timeout;
  return timeout;
}

// VIOLATION: code-quality/deterministic/missing-env-validation
export function missingEnvValidationViolation() {
  const dbUrl = process.env.DATABASE_URL;
  return dbUrl;
}

// VIOLATION: code-quality/deterministic/missing-return-type
export function missingReturnTypeViolation(x: number) {
  return x * 2;
}

// VIOLATION: code-quality/deterministic/nested-template-literal
export function nestedTemplateLiteralViolation(name: string, greeting: string) {
  return `Hello, ${`${greeting} ${name}`}!`;
}

// VIOLATION: code-quality/deterministic/prefer-object-literal
export function preferObjectLiteralViolation() {
  const obj = {};
  obj.name = 'Alice';
  obj.age = 30;
  return obj;
}

// VIOLATION: code-quality/deterministic/primitive-wrapper
export function primitiveWrapperViolation() {
  return new String('hello');
}

// VIOLATION: code-quality/deterministic/symbol-description
export function symbolDescriptionViolation() {
  return Symbol();
}

// VIOLATION: code-quality/deterministic/this-aliasing
export class ThisAliasingViolation {
  value = 42;
  getHandler() {
    const self = this;
    return function() {
      return self.value;
    };
  }
}

// VIOLATION: code-quality/deterministic/undef-init
export function undefInitViolation() {
  let x = undefined;
  x = 42;
  return x;
}

// VIOLATION: code-quality/deterministic/undefined-assignment
export function undefinedAssignmentViolation() {
  let x = 10;
  x = undefined;
  return x;
}

// VIOLATION: code-quality/deterministic/undefined-passed-as-optional
export function undefinedPassedViolation(a: number, b?: string) {
  return a;
}
export function callWithUndefined() {
  return undefinedPassedViolation(1, undefined);
}

// VIOLATION: code-quality/deterministic/unnecessary-boolean-compare
export function unnecessaryBoolCompareViolation(flag: boolean) {
  if (flag === true) {
    return 'yes';
  }
  return 'no';
}

// VIOLATION: code-quality/deterministic/unnecessary-label
export function unnecessaryLabelViolation() {
  myLabel:
  for (let i = 0; i < 10; i++) {
    if (i === 5) break;
  }
}

// VIOLATION: code-quality/deterministic/useless-catch
export function uselessCatchViolation() {
  try {
    return JSON.parse('{}');
  } catch (err) {
    throw err;
  }
}

// VIOLATION: code-quality/deterministic/deprecated-api-usage
/** @deprecated Use newHelper instead */
function oldHelper() {
  return 42;
}

export function deprecatedUsageViolation() {
  return oldHelper();
}

// VIOLATION: code-quality/deterministic/ungrouped-shorthand-properties
export function ungroupedShorthandViolation() {
  const name = 'Alice';
  const age = 30;
  const city = 'NYC';
  return { name, title: 'Dr.', age, address: '123 St', city };
}

// VIOLATION: code-quality/deterministic/selector-parameter
export function selectorParamViolation(isVerbose: boolean) {
  if (isVerbose) {
    return 'detailed output';
  }
  return 'short output';
}

// VIOLATION: code-quality/deterministic/require-unicode-regexp
export const regexNoUnicodeViolation = /hello/;

// VIOLATION: code-quality/deterministic/regex-complexity
export const regexComplexityViolation = /(?=abc)(?!def)(group1)(group2)(group3)(group4)(group5)/;

// VIOLATION: code-quality/deterministic/regex-concise
export const regexConciseViolation = /[0-9]+/;

// VIOLATION: code-quality/deterministic/regex-unused-group
export function regexUnusedGroupViolation(text: string) {
  const pattern = /(?<year>\d{4})-(?<month>\d{2})/;
  return pattern.test(text);
}

// VIOLATION: code-quality/deterministic/regex-empty-after-reluctant
export const regexEmptyReluctantViolation = /a*?b?/;

// VIOLATION: code-quality/deterministic/restricted-api-usage
export function restrictedApiViolation(obj: any) {
  return obj.__defineGetter__('prop', () => 42);
}

// VIOLATION: code-quality/deterministic/undefined-as-identifier
export function undefinedAsIdentifierViolation() {
  let undefined = 'oops';
  return undefined;
}

// VIOLATION: code-quality/deterministic/variable-shadowing
// (needsDataFlow — structural sample)
const shadowedVar = 'outer';
export function variableShadowingViolation() {
  const shadowedVar = 'inner';
  return shadowedVar;
}

// VIOLATION: code-quality/deterministic/unused-scope-definition
// (needsDataFlow — structural sample)
function unusedScopeDefViolation() {
  const unusedLocal = 42;
  return 0;
}
export { unusedScopeDefViolation };

// VIOLATION: code-quality/deterministic/block-scoped-var
// (needsDataFlow — structural sample)
export function blockScopedVarViolation(condition: boolean) {
  if (condition) {
    var leakedVar = 42;
  }
  return leakedVar;
}

declare const something: any;
