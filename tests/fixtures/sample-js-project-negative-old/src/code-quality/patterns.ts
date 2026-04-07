/**
 * Code quality violations related to code patterns.
 */

// VIOLATION: code-quality/deterministic/prefer-const
export function preferConst() {
  let x = 42;
  return x;
}

// VIOLATION: code-quality/deterministic/unused-expression
export function unusedExpression(x: number) {
  x + 1;
  return x;
}

// VIOLATION: code-quality/deterministic/redundant-jump
export function redundantJump(arr: number[]) {
  for (const item of arr) {
    console.log(item);
    continue;
  }
}

// VIOLATION: code-quality/deterministic/no-new-wrappers
export function noNewWrappers() {
  const str = new String('hello');
  const num = new Number(42);
  return { str, num };
}

// VIOLATION: code-quality/deterministic/useless-constructor
class BaseClass {
  constructor(public name: string) {}
}
export class UselessConstructor extends BaseClass {
  constructor(name: string) {
    super(name);
  }
}

// VIOLATION: code-quality/deterministic/useless-escape
export const uselessEscape = 'he\llo';

// VIOLATION: code-quality/deterministic/useless-rename
export function uselessRename() {
  const obj = { name: 'Alice', age: 30 };
  const { name: name } = obj;
  return name;
}

// VIOLATION: code-quality/deterministic/useless-computed-key
export function uselessComputedKey() {
  return { ['name']: 'Alice' };
}

// VIOLATION: code-quality/deterministic/useless-concat
export function uselessConcat() {
  return 'hello' + 'world';
}

// VIOLATION: code-quality/deterministic/inverted-boolean
export function invertedBoolean(x: number) {
  return !!x;
}

// VIOLATION: code-quality/deterministic/prefer-single-boolean-return
export function preferSingleBooleanReturn(x: number) {
  if (x > 0) {
    return true;
  }
  return false;
}

// VIOLATION: code-quality/deterministic/prefer-immediate-return
export function preferImmediateReturn(x: number) {
  const result = x * 2;
  return result;
}

// VIOLATION: code-quality/deterministic/prefer-while
export function preferWhile() {
  for (; true; ) {
    break;
  }
}

// VIOLATION: code-quality/deterministic/prefer-object-spread
export function preferObjectSpread(a: object, b: object) {
  return Object.assign({}, a, b);
}

// VIOLATION: code-quality/deterministic/prefer-optional-chain
export function preferOptionalChain(obj: { value: string } | null) {
  return obj && obj.value;
}

// VIOLATION: code-quality/deterministic/prefer-nullish-coalescing
export function preferNullishCoalescing(x: string | null) {
  return x !== null && x !== undefined ? x : 'default';
}

// VIOLATION: code-quality/deterministic/parameter-reassignment
export function parameterReassignment(x: number) {
  x = x + 1;
  return x;
}

// VIOLATION: code-quality/deterministic/no-lonely-if
export function noLonelyIf(a: boolean, b: boolean) {
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
export function withStatement(obj: any) {
  with (obj) {
    return name;
  }
}

// VIOLATION: code-quality/deterministic/no-label-var
export function noLabelVar() {
  const x = 42;
  x:
  for (let i = 0; i < 10; i++) {
    break x;
  }
  return x;
}

// VIOLATION: code-quality/deterministic/labels-usage
export function labelsUsage() {
  outer:
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      if (j === 5) continue outer;
    }
  }
}

// VIOLATION: code-quality/deterministic/function-in-loop
export function functionInLoop() {
  const fns: (() => number)[] = [];
  for (let i = 0; i < 10; i++) {
    fns.push(function() { return i; });
  }
  return fns;
}

// VIOLATION: code-quality/deterministic/no-caller
export function noCaller() {
  return arguments.callee;
}

// VIOLATION: code-quality/deterministic/no-iterator
export function noIterator(obj: any) {
  obj.__iterator__ = function() {};
  return obj;
}

// VIOLATION: code-quality/deterministic/extend-native
export function extendNative() {
  // @ts-ignore
  Array.prototype.myMethod = function() { return this.length; };
}

// VIOLATION: code-quality/deterministic/array-constructor
export function arrayConstructor() {
  return new Array(1, 2, 3);
}

// VIOLATION: code-quality/deterministic/multi-assign
export function multiAssign() {
  let a: number, b: number, c: number;
  a = b = c = 42;
  return a + b + c;
}

// VIOLATION: code-quality/deterministic/bitwise-in-boolean
export function bitwiseInBoolean(a: boolean, b: boolean) {
  if (a | b) {
    return true;
  }
  return false;
}

// VIOLATION: code-quality/deterministic/no-return-assign
export function noReturnAssign(x: number) {
  return x = x + 1;
}

// VIOLATION: code-quality/deterministic/no-sequences
export function noSequences() {
  let a = 1, b = 2;
  return (a++, b++, a + b);
}

// VIOLATION: code-quality/deterministic/duplicate-string
export function duplicateString() {
  const a = 'this-is-a-long-repeated-string';
  const b = 'this-is-a-long-repeated-string';
  const c = 'this-is-a-long-repeated-string';
  return a + b + c;
}

// VIOLATION: code-quality/deterministic/commented-out-code
export function commentedOutCode() {
  // const x = 42;
  // return x * 2;
  return 0;
}

// VIOLATION: code-quality/deterministic/default-case-last
export function defaultCaseLast(x: number) {
  switch (x) {
    default:
      return 'default';
    case 1:
      return 'one';
    case 2:
      return 'two';
  }
}
