/**
 * Bug violations that require type-aware analysis (needsTypeQuery: true).
 * These rules use TypeQueryService for type checking.
 * NOTE: Some may need type-aware testing later (requires tsconfig + compiler).
 */

// VIOLATION: bugs/deterministic/argument-type-mismatch
// Passing wrong argument type to function (needs typeQuery.hasTypeErrorInRange)
function expectNumber(n: number): number { return n; }
export function argumentTypeMismatch() {
  return expectNumber('not a number');
}

// VIOLATION: bugs/deterministic/await-non-thenable
// Awaiting a value that is not a Promise/Thenable (needs typeQuery.isPromiseLike)
export async function awaitNonThenable() {
  const value = 42;
  // @ts-ignore
  const result = await value;
  return result;
}

// VIOLATION: bugs/deterministic/base-to-string
// Calling .toString() on a plain object produces "[object Object]" (needs typeQuery)
export function baseToString(data: { name: string }) {
  return data.toString();
}

// VIOLATION: bugs/deterministic/function-return-type-varies
// Function returns string from one branch and number from another (needs typeQuery)
export function functionReturnTypeVaries(flag: boolean) {
  if (flag) {
    return 'hello';
  }
  return 42;
}

// VIOLATION: bugs/deterministic/loose-boolean-expression
// Non-boolean type used as condition in if statement (needs typeQuery.isBooleanType)
export function looseBooleanExpression(count: number) {
  if (count) {
    return 'has items';
  }
  return 'empty';
}

// VIOLATION: bugs/deterministic/missing-await
// Async function result stored without await (needs typeQuery.isPromiseLike)
async function fetchUserData(): Promise<{ name: string }> {
  return { name: 'test' };
}
export async function missingAwait() {
  const data = fetchUserData();
  return data;
}

// VIOLATION: bugs/deterministic/misused-promise
// Promise used in boolean context without await (needs typeQuery.isPromiseLike)
export async function misusedPromise() {
  const promise = Promise.resolve(true);
  return promise ? 'always true — Promise objects are truthy' : 'unreachable';
}

// VIOLATION: bugs/deterministic/misused-spread
// Spreading a string into an array yields individual characters (needs typeQuery)
export function misusedSpread(str: string) {
  return [...str];
}

// VIOLATION: bugs/deterministic/non-number-arithmetic
// Arithmetic operator used with non-numeric operand (needs typeQuery)
export function nonNumberArithmetic(a: string, b: number) {
  // @ts-ignore
  return a - b;
}

// VIOLATION: bugs/deterministic/restrict-plus-operands
// Adding values of mismatched types: string + number (needs typeQuery)
export function restrictPlusOperands(count: number, label: string) {
  // @ts-ignore
  return count + label;
}

// VIOLATION: bugs/deterministic/restrict-template-expressions
// Object interpolated in template literal produces "[object Object]" (needs typeQuery)
export function restrictTemplateExpressions(data: { key: string }) {
  return `Result: ${data}`;
}

// VIOLATION: bugs/deterministic/switch-exhaustiveness
// Switch on union type without covering all members and no default (needs typeQuery)
export function switchExhaustiveness(status: 'active' | 'inactive' | 'pending') {
  switch (status) {
    case 'active':
      return 1;
    case 'inactive':
      return 0;
    // Missing 'pending' case and no default
  }
}

// VIOLATION: bugs/deterministic/unsafe-enum-comparison
// Comparing enum value with raw number instead of enum member (needs typeQuery)
enum Color {
  Red = 0,
  Green = 1,
  Blue = 2,
}
export function unsafeEnumComparison(n: number) {
  const c = Color.Red;
  return c === n;
}

// VIOLATION: bugs/deterministic/unsafe-type-assertion
// Type assertion between incompatible types that hides errors (needs typeQuery)
export function unsafeTypeAssertion() {
  const num: number = 42;
  // @ts-ignore
  return num as string;
}

// VIOLATION: bugs/deterministic/unsafe-unary-minus
// Unary minus on non-numeric type (needs typeQuery)
export function unsafeUnaryMinus(s: string) {
  // @ts-ignore
  return -s;
}

// VIOLATION: bugs/deterministic/unhandled-promise
// Promise expression as statement without await, .catch(), or void (needs typeQuery)
export async function unhandledPromise() {
  const p = Promise.resolve('forgotten');
  p;
}

// VIOLATION: bugs/deterministic/values-not-convertible-to-number
// Relational comparison with non-numeric type like boolean (needs typeQuery)
export function valuesNotConvertibleToNumber(a: boolean, b: number) {
  // @ts-ignore
  return a > b;
}

// VIOLATION: bugs/deterministic/void-return-value
// Assigning return value of a void function (needs typeQuery.getReturnType)
function doSideEffect(): void {
  console.log('side effect');
}
export function voidReturnValue() {
  const result = doSideEffect();
  return result;
}
