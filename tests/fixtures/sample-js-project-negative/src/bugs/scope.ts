/**
 * Bug violations related to scope and declarations.
 */

// VIOLATION: bugs/deterministic/variable-redeclaration
export function variableRedeclaration() {
  var x = 1;
  var x = 2;
  return x;
}

// VIOLATION: bugs/deterministic/restricted-name-shadowing
export function restrictedNameShadowing() {
  const undefined = 42;
  return undefined;
}

// VIOLATION: bugs/deterministic/case-declaration-leak
export function caseDeclarationLeak(x: number) {
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
export function labelVariableCollision() {
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
export function labelOnNonLoop() {
  label:
  if (true) {
    break label;
  }
}

// VIOLATION: bugs/deterministic/unassigned-variable
export function unassignedVariable() {
  let x: number;
  return x + 1;
}

// VIOLATION: bugs/deterministic/global-this-usage
// @ts-ignore
export const globalThisUsageResult = this;

// VIOLATION: bugs/deterministic/no-obj-calls
export function noObjCalls() {
  // @ts-ignore
  return Math();
}

// VIOLATION: bugs/deterministic/misused-new-keyword
export interface MisusedNewInterface {
  constructor(): void;
}
