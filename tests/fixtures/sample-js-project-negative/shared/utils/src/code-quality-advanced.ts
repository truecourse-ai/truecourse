/**
 * Advanced code quality patterns — blocks, regex, patterns.
 */

// VIOLATION: code-quality/deterministic/unnecessary-block
export function extraBlock() {
  let x = 42;
  {
    x = 43;
  }
  return x;
}

// VIOLATION: code-quality/deterministic/unnecessary-call-apply
export function callApply() {
  const fn = () => 42;
  return fn.call();
}

// VIOLATION: code-quality/deterministic/unnecessary-bind
export function arrowBind() {
  return (() => 42).bind(this);
}

// VIOLATION: code-quality/deterministic/implicit-type-coercion
export function unaryPlus(value: string) {
  return +value;
}

// VIOLATION: code-quality/deterministic/associative-array
export function arrayAsMap() {
  const arr: any[] = [];
  arr['key'] = 'value';
  return arr;
}

// VIOLATION: code-quality/deterministic/regex-empty-group
export const emptyGroup = /test()/;

// VIOLATION: code-quality/deterministic/regex-single-char-class
export const singleCharClass = /[a]bc/;

// VIOLATION: code-quality/deterministic/hardcoded-url
export const apiUrl = 'https://api.production-server.com/v1/users';

// VIOLATION: code-quality/deterministic/empty-static-block
export class EmptyStatic {
  static {
  }
  value = 42;
}

// VIOLATION: code-quality/deterministic/negated-condition
export function negated(x: number) {
  if (!x) {
    return 'falsy';
  } else {
    return 'truthy';
  }
}

// VIOLATION: code-quality/deterministic/trivial-ternary
export function ternaryBool(x: boolean) {
  return x ? true : false;
}

// VIOLATION: code-quality/deterministic/trivial-switch
export function oneCase(x: number) {
  switch (x) {
    case 1:
      return 'one';
    default:
      return 'other';
  }
}

// VIOLATION: code-quality/deterministic/verbose-object-constructor
export function newObj() {
  return new Object();
}

// VIOLATION: code-quality/deterministic/legacy-has-own-property
export function hasOwn(obj: Record<string, any>, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// VIOLATION: code-quality/deterministic/collapsible-else-if
export function elseIfCollapse(a: number) {
  if (a > 10) {
    return 'big';
  } else {
    if (a > 5) {
      return 'medium';
    }
  }
  return 'small';
}

// VIOLATION: code-quality/deterministic/multiline-block-without-braces
export function noBraces(x: number) {
  if (x > 0)
    console.log('positive');
  return x;
}

// VIOLATION: code-quality/deterministic/misleading-same-line-conditional
export function sameLine(x: number) {
  if (x > 0) return x; if (x < 0) return -x;
  return 0;
}

// VIOLATION: code-quality/deterministic/regex-multiple-spaces
export const multiSpace = /hello   world/;

// VIOLATION: code-quality/deterministic/unnecessary-promise-wrap
export function wrapResolve() {
  return new Promise((resolve) => {
    resolve(fetch('/api'));
  });
}

// VIOLATION: code-quality/deterministic/string-comparison
export function compareStrings() {
  return 'apple' > 'banana';
}

// VIOLATION: code-quality/deterministic/deep-callback-nesting
export function deepCallback(callback: Function) {
  setTimeout(() => {
    setTimeout(() => {
      setTimeout(() => {
        setTimeout(() => {
          callback();
        }, 100);
      }, 100);
    }, 100);
  }, 100);
}

// VIOLATION: code-quality/deterministic/default-parameter-position
export function defaultFirst(a: number = 0, b: number) {
  return a + b;
}

// VIOLATION: code-quality/deterministic/indexed-loop-over-for-of
export function indexLoop(arr: string[]) {
  const result: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(arr[i]);
  }
  return result;
}

// VIOLATION: code-quality/deterministic/filter-first-over-find
export function filterFirst(arr: number[]) {
  return arr.filter((x) => x > 10)[0];
}

// VIOLATION: code-quality/deterministic/substring-over-starts-ends
export function indexOfZero(str: string) {
  return str.indexOf('prefix') === 0;
}

// VIOLATION: code-quality/deterministic/no-extraneous-class
export class OnlyStatic {
  static getValue() {
    return 42;
  }
}

// VIOLATION: code-quality/deterministic/dynamic-delete
export function deleteDynamic(obj: Record<string, any>, key: string) {
  delete obj[key];
}
