/**
 * Utility functions demonstrating common code quality issues.
 */

// VIOLATION: code-quality/deterministic/no-explicit-any
export function processData(data: any): any {
  return data;
}

// VIOLATION: code-quality/deterministic/no-debugger
export function debugCheck() {
  debugger;
  return true;
}

// VIOLATION: code-quality/deterministic/no-alert
export function showAlert() {
  alert('hello');
}

// VIOLATION: code-quality/deterministic/strict-equality
export function looseCompare(a: number, b: number) {
  if (a == b) {
    return true;
  }
  if (a != b) {
    return false;
  }
  return null;
}

// VIOLATION: code-quality/deterministic/no-throw-literal
export function throwString() {
  throw 'something went wrong';
}

// VIOLATION: code-quality/deterministic/no-script-url
export function getLink() {
  const link = 'javascript:void(0)';
  return link;
}

// VIOLATION: code-quality/deterministic/no-proto
export function getProto(obj: any) {
  return obj.__proto__;
}

// VIOLATION: code-quality/deterministic/no-void
export function voidCall() {
  return void someFunction();
}
function someFunction() { return 42; }

// VIOLATION: code-quality/deterministic/console-log
export function logDebug() {
  console.log('debug output');
  console.debug('more debug');
  return 42;
}

// VIOLATION: code-quality/deterministic/prefer-const
export function useConst() {
  let x = 42;
  return x;
}

// VIOLATION: code-quality/deterministic/unused-expression
export function noEffect(x: number) {
  x + 1;
  return x;
}

// VIOLATION: code-quality/deterministic/redundant-jump
export function extraContinue(arr: number[]) {
  for (const item of arr) {
    console.log(item);
    continue;
  }
}

// VIOLATION: code-quality/deterministic/no-new-wrappers
export function wrapperTypes() {
  const str = new String('hello');
  const num = new Number(42);
  return { str, num };
}

// VIOLATION: code-quality/deterministic/useless-constructor
class Base {
  constructor(public name: string) {}
}
export class Derived extends Base {
  constructor(name: string) {
    super(name);
  }
}

// VIOLATION: code-quality/deterministic/useless-escape
export const escaped = 'he\llo';

// VIOLATION: code-quality/deterministic/useless-rename
export function destructureRename() {
  const obj = { name: 'Alice', age: 30 };
  const { name: name } = obj;
  return name;
}

// VIOLATION: code-quality/deterministic/useless-computed-key
export function computedKey() {
  return { ['name']: 'Alice' };
}

// VIOLATION: code-quality/deterministic/useless-concat
export function staticConcat() {
  return 'hello' + 'world';
}

// VIOLATION: code-quality/deterministic/inverted-boolean
export function doubleNegate(x: number) {
  return !!x;
}

// VIOLATION: code-quality/deterministic/prefer-single-boolean-return
export function boolReturn(x: number) {
  if (x > 0) {
    return true;
  }
  return false;
}

// VIOLATION: code-quality/deterministic/prefer-immediate-return
export function tempReturn(x: number) {
  const result = x * 2;
  return result;
}

// VIOLATION: code-quality/deterministic/prefer-while
export function emptyFor() {
  for (; true; ) {
    break;
  }
}

// VIOLATION: code-quality/deterministic/prefer-object-spread
export function mergeObjects(a: object, b: object) {
  return Object.assign({}, a, b);
}

// VIOLATION: code-quality/deterministic/prefer-optional-chain
export function optionalChain(obj: { value: string } | null) {
  return obj && obj.value;
}

// VIOLATION: code-quality/deterministic/prefer-nullish-coalescing
export function nullishCoalesce(x: string | null) {
  return x !== null && x !== undefined ? x : 'default';
}

// VIOLATION: code-quality/deterministic/parameter-reassignment
export function reassignParam(x: number) {
  x = x + 1;
  return x;
}

// VIOLATION: code-quality/deterministic/no-lonely-if
export function lonelyIf(a: boolean, b: boolean) {
  if (a) {
    return 'a';
  } else {
    if (b) {
      return 'b';
    }
  }
  return 'none';
}

// VIOLATION: code-quality/deterministic/with-statement
export function useWith(obj: any) {
  with (obj) {
    return name;
  }
}

// VIOLATION: code-quality/deterministic/no-label-var
export function labelVar() {
  const x = 42;
  x:
  for (let i = 0; i < 10; i++) {
    break x;
  }
  return x;
}

// VIOLATION: code-quality/deterministic/labels-usage
export function useLabels() {
  outer:
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      if (j === 5) continue outer;
    }
  }
}

// VIOLATION: code-quality/deterministic/function-in-loop
export function closureInLoop() {
  const fns: (() => number)[] = [];
  for (let i = 0; i < 10; i++) {
    fns.push(function() { return i; });
  }
  return fns;
}

// VIOLATION: code-quality/deterministic/no-caller
export function useCaller() {
  return arguments.callee;
}

// VIOLATION: code-quality/deterministic/no-iterator
export function setIterator(obj: any) {
  obj.__iterator__ = function() {};
  return obj;
}

// VIOLATION: code-quality/deterministic/extend-native
export function extendArray() {
  // @ts-ignore
  Array.prototype.myMethod = function() { return this.length; };
}

// VIOLATION: code-quality/deterministic/array-constructor
export function newArray() {
  return new Array(1, 2, 3);
}

// VIOLATION: code-quality/deterministic/multi-assign
export function chainAssign() {
  let a: number, b: number, c: number;
  a = b = c = 42;
  return a + b + c;
}

// VIOLATION: code-quality/deterministic/bitwise-in-boolean
export function bitwiseInBool(a: boolean, b: boolean) {
  if (a | b) {
    return true;
  }
  return false;
}

// VIOLATION: code-quality/deterministic/no-return-assign
export function returnAssign(x: number) {
  return x = x + 1;
}

// VIOLATION: code-quality/deterministic/no-sequences
export function useSequence() {
  let a = 1, b = 2;
  return (a++, b++, a + b);
}

// VIOLATION: code-quality/deterministic/duplicate-string
export function repeatString() {
  const a = 'this-is-a-long-repeated-string';
  const b = 'this-is-a-long-repeated-string';
  const c = 'this-is-a-long-repeated-string';
  return a + b + c;
}

// VIOLATION: code-quality/deterministic/commented-out-code
export function withComments() {
  // const x = 42;
  // return x * 2;
  return 0;
}

// VIOLATION: code-quality/deterministic/default-case-last
export function switchOrder(x: number) {
  switch (x) {
    default:
      return 'default';
    case 1:
      return 'one';
    case 2:
      return 'two';
  }
}
