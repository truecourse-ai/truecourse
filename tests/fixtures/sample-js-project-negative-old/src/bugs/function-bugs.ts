/**
 * Bug violations related to function patterns.
 */

// VIOLATION: bugs/deterministic/extra-arguments-ignored
// IIFE with 1 parameter called with 3 arguments — extras silently ignored
export function extraArgumentsIgnored() {
  return ((x: number) => {
    return x * 2;
  })(1, 2, 3);
}

// VIOLATION: bugs/deterministic/constructor-return
// Class constructor returns a value, replacing the constructed instance
export class ConstructorReturnsValue {
  value: number;
  constructor() {
    this.value = 42;
    return { value: 99, extra: true };
  }
}

// VIOLATION: bugs/deterministic/setter-return
// Setter returns a value — return value is always ignored
export class SetterReturnsValue {
  private _name = '';
  set name(val: string) {
    this._name = val;
    return val;
  }
  get name() {
    return this._name;
  }
}

// VIOLATION: bugs/deterministic/unbound-method
// this.method used as a value (passed as callback) without binding
export class UnboundMethodExample {
  items: string[] = [];

  processItems() {
    this.items.forEach(this.handleItem);
  }

  handleItem(item: string) {
    console.log(item);
  }
}

// VIOLATION: bugs/deterministic/arguments-order-mismatch
// First arg to .startsWith() matches the receiver variable name
export function argumentsOrderMismatch() {
  const haystack = 'hello world';
  return haystack.startsWith(haystack);
}

// VIOLATION: bugs/deterministic/comma-in-switch-case
// Comma expression in switch case — only last value is matched
export function commaInSwitchCase(x: number) {
  switch (x) {
    case (1, 2):
      return 'matched';
    default:
      return 'default';
  }
}
