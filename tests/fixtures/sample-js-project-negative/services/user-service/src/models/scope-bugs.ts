/**
 * Scope, declaration, and function bug patterns.
 */

// VIOLATION: bugs/deterministic/variable-redeclaration
export function varRedeclare() {
  var x = 1;
  var x = 2;
  return x;
}

// VIOLATION: bugs/deterministic/restricted-name-shadowing
export function shadowUndefined() {
  const undefined = 42;
  return undefined;
}

// VIOLATION: bugs/deterministic/case-declaration-leak
export function leakyCase(x: number) {
  switch (x) {
    case 1:
      let value = 'one';
      return value;
    case 2:
      value = 'two';
      return value;
    default:
      return 'other';
  }
}

// VIOLATION: bugs/deterministic/label-variable-collision
export function labelCollision() {
  const x = 42;
  x:
  for (let i = 0; i < 10; i++) {
    break x;
  }
  return x;
}

// VIOLATION: bugs/deterministic/future-reserved-word
// @ts-ignore
function package() { return 'reserved'; }

// VIOLATION: bugs/deterministic/label-on-non-loop
export function labelNonLoop() {
  label:
  if (true) {
    break label;
  }
}

// VIOLATION: bugs/deterministic/unassigned-variable
export function usedBeforeInit() {
  let x: number;
  return x + 1;
}

// VIOLATION: bugs/deterministic/global-this-usage
// @ts-ignore
export const globalThisRef = this;

// VIOLATION: bugs/deterministic/no-obj-calls
export function callMath() {
  // @ts-ignore
  return Math();
}

// VIOLATION: bugs/deterministic/misused-new-keyword
export interface ConstructorInterface {
  constructor(): void;
}

// VIOLATION: bugs/deterministic/extra-arguments-ignored
export function extraArgs() {
  return ((x: number) => {
    return x * 2;
  })(1, 2, 3);
}

// VIOLATION: bugs/deterministic/constructor-return
export class BadConstructor {
  value: number;
  constructor() {
    this.value = 42;
    return { value: 99, extra: true };
  }
}

// VIOLATION: bugs/deterministic/setter-return
export class SetterWithReturn {
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
export class EventEmitter {
  items: string[] = [];
  processAll() {
    this.items.forEach(this.processItem);
  }
  processItem(item: string) {
    console.log(item);
  }
}

// VIOLATION: bugs/deterministic/arguments-order-mismatch
export function checkOrder() {
  const haystack = 'hello world';
  return haystack.startsWith(haystack);
}

// VIOLATION: bugs/deterministic/comma-in-switch-case
export function commaCase(x: number) {
  switch (x) {
    case (1, 2):
      return 'matched';
    default:
      return 'default';
  }
}
