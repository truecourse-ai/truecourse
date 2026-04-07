/**
 * Miscellaneous bugs — covers remaining bug patterns.
 */

// VIOLATION: bugs/deterministic/template-curly-in-string
export const templateInString = '${name} is a user';

// VIOLATION: bugs/deterministic/only-throw-error
export function throwNonError() {
  throw 'bad input';
}

// VIOLATION: bugs/deterministic/delete-variable
export function deleteVar() {
  let x = 42;
  // @ts-ignore
  delete x;
}

// VIOLATION: bugs/deterministic/constant-binary-expression
export function alwaysTrue() {
  return 'hello' || 'world';
}

// VIOLATION: bugs/deterministic/octal-literal
export function octalPermissions() {
  // @ts-ignore
  return 0777;
}

// VIOLATION: bugs/deterministic/loss-of-precision
export const bigInt = 9007199254740993;

// VIOLATION: bugs/deterministic/index-of-positive-check
export function badIndexCheck(arr: string[]) {
  return arr.indexOf('item') > 0;
}

// VIOLATION: bugs/deterministic/non-number-arithmetic
export function stringMath() {
  // @ts-ignore
  return 'hello' - 1;
}

// VIOLATION: bugs/deterministic/incorrect-string-concat
export function stringPlusNumber() {
  const count = 5;
  return 'Items: ' + count + 1;
}

// VIOLATION: bugs/deterministic/symbol-description
export function noSymbolDesc() {
  return Symbol();
}

// VIOLATION: bugs/deterministic/empty-pattern
export function emptyDestructure() {
  const {} = { a: 1, b: 2 };
}

// VIOLATION: bugs/deterministic/self-assignment
export function assignToSelf() {
  let x = 42;
  x = x;
  return x;
}

// VIOLATION: bugs/deterministic/no-inner-declarations
export function outerScope() {
  if (true) {
    function innerDecl() {
      return 42;
    }
    return innerDecl();
  }
}

// VIOLATION: bugs/deterministic/new-operator-misuse
export function misusedNew() {
  const fn = () => 42;
  // @ts-ignore
  const result = new fn();
  return result;
}

// VIOLATION: bugs/deterministic/useless-increment
export function returnAndIncrement(x: number) {
  return x++;
}

// VIOLATION: bugs/deterministic/element-overwrite
export function overwriteElement() {
  const obj: Record<string, number> = {};
  obj['key'] = 1;
  obj['key'] = 2;
  return obj;
}

// VIOLATION: bugs/deterministic/missing-super-call
export class MissingSuperCall extends Error {
  constructor(msg: string) {
    // Missing super(msg) call
    // @ts-ignore
    this.message = msg;
  }
}

// VIOLATION: bugs/deterministic/this-before-super
export class EarlyThis extends Error {
  name = 'EarlyThis';
  constructor(msg: string) {
    // @ts-ignore
    this.name = 'Error';
    super(msg);
  }
}

// VIOLATION: bugs/deterministic/async-constructor
export class AsyncInit {
  data: any;
  // @ts-ignore
  async constructor() {
    this.data = await fetch('/api').then((r) => r.json());
  }
}

// VIOLATION: bugs/deterministic/class-reassignment
let MyClass = class {};
MyClass = class {};
export { MyClass };

// VIOLATION: bugs/deterministic/import-reassignment
import { readFileSync as readFile } from 'fs';
// @ts-ignore
readFile = () => Buffer.from('');

// VIOLATION: bugs/deterministic/collection-size-mischeck
export function checkMapSize(map: Map<string, number>) {
  if (map.size === -1) {
    return false;
  }
  return true;
}

// VIOLATION: bugs/deterministic/missing-radix
export function parseWithoutRadix(input: string) {
  return parseInt(input);
}

// VIOLATION: bugs/deterministic/function-reassignment
export function reassignFunc() {
  function inner() { return 1; }
  // @ts-ignore
  inner = () => 2;
  return inner();
}

// VIOLATION: bugs/deterministic/function-return-type-varies
export function inconsistentType(x: number) {
  if (x > 0) return 'positive';
  if (x < 0) return -1;
  return null;
}

// VIOLATION: bugs/deterministic/global-reassignment
export function reassignGlobal() {
  // @ts-ignore
  undefined = 'oops';
}

// VIOLATION: bugs/deterministic/shared-mutable-module-state
export const mutableState = { count: 0, items: [] as string[] };

// VIOLATION: bugs/deterministic/switch-exhaustiveness
export function handleDirection(dir: 'up' | 'down' | 'left' | 'right'): string {
  switch (dir) {
    case 'up':
      return 'going up';
    case 'down':
      return 'going down';
  }
}

// VIOLATION: bugs/deterministic/unsafe-enum-comparison
export enum Color { Red, Blue, Green }
export function compareEnum(c: Color) {
  // @ts-ignore
  return c === 'Red';
}

// VIOLATION: bugs/deterministic/unsafe-negation
export function negationPrecedence(obj: any) {
  // @ts-ignore
  return !obj instanceof Error;
}

// VIOLATION: bugs/deterministic/unsafe-type-assertion
export function broadAssert(input: unknown) {
  return input as string;
}

// VIOLATION: bugs/deterministic/unsafe-unary-minus
export function negateNonNumber() {
  const x = '5';
  // @ts-ignore
  return -x;
}

// VIOLATION: bugs/deterministic/unhandled-promise
export function unhandled() {
  Promise.resolve(42);
}

// VIOLATION: bugs/deterministic/values-not-convertible-to-number
export function convertToNumber() {
  // @ts-ignore
  return Number('abc');
}

// VIOLATION: bugs/deterministic/void-zero-argument
export function voidNoArg() {
  return void 0;
}

// VIOLATION: bugs/deterministic/prototype-pollution
export function mergeDeep(target: any, source: any) {
  for (const key of Object.keys(source)) {
    target[key] = source[key];
  }
  return target;
}

// VIOLATION: bugs/deterministic/restrict-plus-operands
export function addMixed() {
  const x = '5';
  const y = 3;
  // @ts-ignore
  return x + y;
}

// VIOLATION: bugs/deterministic/misused-spread
export function spreadPrimitive() {
  // @ts-ignore
  return { ...42 };
}

// VIOLATION: bugs/deterministic/misused-promise
export function boolPromise() {
  const p = Promise.resolve(true);
  // @ts-ignore
  if (p) {
    return 'truthy';
  }
}

// VIOLATION: bugs/deterministic/missing-await
export async function forgot() {
  const p = Promise.resolve(42);
  return p;
}

export { readFile };
