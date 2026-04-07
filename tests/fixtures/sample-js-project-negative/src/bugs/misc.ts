/**
 * Miscellaneous bug violations.
 */

// VIOLATION: bugs/deterministic/sparse-array
export const sparseArr = [1, , 3, , 5];

// VIOLATION: bugs/deterministic/template-curly-in-string
export function templateCurlyInString(name: string) {
  return 'Hello ${name}, welcome!';
}

// VIOLATION: bugs/deterministic/loss-of-precision
export const bigNumber = 9007199254740993;

// VIOLATION: bugs/deterministic/unsafe-negation
export function unsafeNegation(obj: object, key: string) {
  return !key instanceof Object;
}

// VIOLATION: bugs/deterministic/non-existent-operator
export function nonExistentOperator(a: number, b: number) {
  // @ts-ignore
  return a =+ b;
}

// VIOLATION: bugs/deterministic/useless-increment
export function uselessIncrement(x: number) {
  ++x;
  return x;
}

// VIOLATION: bugs/deterministic/element-overwrite
export function elementOverwrite() {
  const obj: Record<string, number> = {};
  obj['key'] = 1;
  obj['key'] = 2;
  return obj;
}

// VIOLATION: bugs/deterministic/prototype-pollution
export function prototypePollution(obj: Record<string, any>, key: string, value: any) {
  obj[key] = value;
}

// VIOLATION: bugs/deterministic/symbol-description
export const sym = Symbol();

// VIOLATION: bugs/deterministic/void-zero-argument
export function voidZeroArgument() {
  return void 0;
}

// VIOLATION: bugs/deterministic/empty-character-class
export const emptyCharClass = /abc[]/;

// VIOLATION: bugs/deterministic/no-inner-declarations
export function noInnerDeclarations(x: boolean) {
  if (x) {
    function innerFunc() {
      return 42;
    }
    return innerFunc();
  }
  return 0;
}

// VIOLATION: bugs/deterministic/only-throw-error
export function onlyThrowError() {
  throw 'not an error object';
}

// VIOLATION: bugs/deterministic/index-of-positive-check
export function indexOfPositiveCheck(arr: number[], item: number) {
  if (arr.indexOf(item) > 0) {
    return true;
  }
  return false;
}

// VIOLATION: bugs/deterministic/array-delete
export function arrayDelete() {
  const arr = [1, 2, 3, 4, 5];
  delete arr[2];
  return arr;
}

// VIOLATION: bugs/deterministic/for-in-array
export function forInArray() {
  const result: number[] = [];
  for (const i in [1, 2, 3]) {
    result.push(Number(i));
  }
  return result;
}

// VIOLATION: bugs/deterministic/reduce-missing-initial
export function reduceMissingInitial(arr: number[]) {
  return arr.reduce((acc, val) => acc + val);
}

// VIOLATION: bugs/deterministic/array-sort-without-compare
export function arraySortWithoutCompare(arr: number[]) {
  return arr.sort();
}

// VIOLATION: bugs/deterministic/missing-radix
export function missingRadix(str: string) {
  return parseInt(str);
}

// VIOLATION: bugs/deterministic/constant-binary-expression
export function constantBinaryExpression() {
  const x = 'hello' + undefined;
  return x;
}

// VIOLATION: bugs/deterministic/inconsistent-return
export function inconsistentReturn(x: number) {
  if (x > 0) {
    return x;
  }
  return;
}

// VIOLATION: bugs/deterministic/incorrect-string-concat
export function incorrectStringConcat() {
  return '1' + 2 + 3;
}

// VIOLATION: bugs/deterministic/literal-call
export function literalCall() {
  // @ts-ignore
  return 42();
}

// VIOLATION: bugs/deterministic/shared-mutable-module-state
export let sharedMutableState: number[] = [];

// VIOLATION: bugs/deterministic/empty-pattern
export function emptyPattern({}: { name: string }) {
  return 'nothing destructured';
}

// VIOLATION: bugs/deterministic/global-reassignment
// @ts-ignore
undefined = 42;

// VIOLATION: bugs/deterministic/delete-variable
export function deleteVariable() {
  let x = 42;
  // @ts-ignore
  delete x;
  return x;
}

// VIOLATION: bugs/deterministic/octal-escape
export const octalEscape = '\251';

// VIOLATION: bugs/deterministic/collection-size-mischeck
export function collectionSizeMischeck(arr: number[]) {
  // @ts-ignore
  if (arr.length === null) {
    return true;
  }
  return false;
}

// VIOLATION: bugs/deterministic/new-operator-misuse
export function newOperatorMisuse() {
  // @ts-ignore
  const sym = new Symbol('test');
  return sym;
}
