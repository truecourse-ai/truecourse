/**
 * Remaining bug patterns not covered elsewhere.
 */

// VIOLATION: bugs/deterministic/async-void-function
async function backgroundTask(): Promise<Response> {
  return fetch('/api');
}
export function fireAndForget() {
  backgroundTask();
}

// VIOLATION: bugs/deterministic/await-non-thenable
export async function awaitLiteral() {
  const x = await 42;
  return x;
}

// NOTE: base-to-string needs typeQuery to detect object types (not resolving in fixture)
export function stringifyObj() {
  const obj: Record<string, number> = {};
  return obj.toString();
}

// VIOLATION: bugs/deterministic/const-reassignment
const constToReassign = 42;
// @ts-ignore
constToReassign = 100;

// VIOLATION: bugs/deterministic/getter-missing-return
export class MissingGetterReturn {
  private _value = '';
  get value(): string {
    // missing return
    this._value;
  }
}

// VIOLATION: bugs/deterministic/inconsistent-return
export function maybeReturn(x: number) {
  if (x > 0) {
    return x;
  }
  // implicit return undefined
}

// VIOLATION: bugs/deterministic/invisible-whitespace
export const invisibleWs = 'hello world';

// VIOLATION: bugs/deterministic/literal-call
export function callLiteral() {
  // @ts-ignore
  return "hello"();
}

// VIOLATION: bugs/deterministic/no-constructor-return
export class ConstructorNoReturn {
  value: number;
  constructor() {
    this.value = 42;
    return { value: 99 };
  }
}

// VIOLATION: bugs/deterministic/no-setter-return
export class SetterNoReturn {
  private _name = '';
  set name(v: string) {
    this._name = v;
    return v;
  }
}

// VIOLATION: bugs/deterministic/non-existent-operator
export function badOperator(a: number, b: number) {
  // @ts-ignore
  a =+ b;
  return a;
}

// VIOLATION: bugs/deterministic/nonstandard-decimal-escape
export const decimalEscape = '\8';

// VIOLATION: bugs/deterministic/octal-escape
export const octalEscapeStr = '\251';

// VIOLATION: bugs/deterministic/void-return-value
export function voidInExpression() {
  function doWork(): void {}
  // @ts-ignore
  const result = doWork();
  return result;
}

// NOTE: use-before-define — rule skips function-scoped TDZ (only detects module-level)
export function useBeforeDef() {
  const y = laterVar;
  const laterVar = 42;
  return y;
}

// VIOLATION: code-quality/deterministic/useless-catch
export function catchAndThrow() {
  try {
    return JSON.parse('{}');
  } catch (e) {
    throw e;
  }
}

// VIOLATION: bugs/deterministic/restrict-template-expressions
export function templateWithObject() {
  const obj = { name: 'test' };
  return `Value: ${obj}`;
}

// VIOLATION: code-quality/deterministic/unnamed-regex-capture
export function unnamedCapture(input: string) {
  const match = input.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match;
}

// VIOLATION: code-quality/deterministic/unnecessary-regex-constructor
export function staticRegex() {
  return new RegExp('hello');
}

// VIOLATION: code-quality/deterministic/prefer-regex-exec
export function matchVsExec(str: string) {
  const regex = /test/g;
  return str.match(regex);
}

// VIOLATION: code-quality/deterministic/regex-unicode-awareness
export const emojiRegex = /\p{Letter}/;

// VIOLATION: bugs/deterministic/useeffect-missing-deps
declare function useEffect(cb: () => void, deps?: any[]): void;
const userId = 'test';
useEffect(() => { console.log(userId); }, []);

// NOTE: mixed-content requires TSX (JSX attributes) - see Dashboard.tsx
export function mixedContentUrl() {
  return fetch('http://api.secure-site.com/data');
}

// NOTE: html-table-accessibility requires TSX (JSX elements) - see ReactBugs.tsx

// VIOLATION: code-quality/deterministic/unread-private-attribute
export class UnreadAttribute {
  private data = 'secret';
  setData(value: string) {
    this.data = value;
  }
  getValue() {
    return 'public';
  }
}
