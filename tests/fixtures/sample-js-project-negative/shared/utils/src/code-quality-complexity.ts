/**
 * Code complexity patterns — nesting, branching, function size.
 */

// VIOLATION: code-quality/deterministic/nested-ternary
export function nestedTernary(x: number) {
  return x > 10 ? 'big' : x > 5 ? 'medium' : 'small';
}

// VIOLATION: code-quality/deterministic/collapsible-if
export function collapsibleIf(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      return true;
    }
  }
  return false;
}

// VIOLATION: code-quality/deterministic/redundant-boolean
export function boolCheck(x: number) {
  if (x > 0) {
    return true;
  } else {
    return false;
  }
}

// VIOLATION: code-quality/deterministic/unnecessary-else-after-return
export function earlyReturn(x: number) {
  if (x > 0) {
    return 'positive';
  } else {
    return 'non-positive';
  }
}

// VIOLATION: code-quality/deterministic/no-empty-function
export function emptyBody() {
}

// VIOLATION: code-quality/deterministic/no-useless-catch
export function rethrow() {
  try {
    return JSON.parse('{}');
  } catch (e) {
    throw e;
  }
}

// VIOLATION: code-quality/deterministic/deeply-nested-functions
export function deepNest() {
  function level1() {
    function level2() {
      function level3() {
        function level4() {
          return 'too deep';
        }
        return level4();
      }
      return level3();
    }
    return level2();
  }
  return level1();
}

// VIOLATION: code-quality/deterministic/nested-switch
export function switchInSwitch(a: number, b: string) {
  switch (a) {
    case 1:
      switch (b) {
        case 'x':
          return 'one-x';
        default:
          return 'one-other';
      }
    default:
      return 'other';
  }
}

// VIOLATION: code-quality/deterministic/cognitive-complexity
export function complexFunction(x: number, y: number, z: number) {
  if (x > 0) {
    if (y > 0) {
      if (z > 0) {
        for (let i = 0; i < x; i++) {
          if (i % 2 === 0) {
            if (i > 5) {
              return 'deep';
            } else {
              if (z > 10) {
                return 'deeper';
              }
            }
          } else {
            if (i > 3) {
              for (let j = 0; j < y; j++) {
                if (j === i) {
                  return 'match';
                }
              }
            }
          }
        }
      } else {
        return 'no z';
      }
    } else {
      if (z > 0) {
        return 'no y but z';
      } else {
        return 'no y no z';
      }
    }
  }
  return 'default';
}

// VIOLATION: code-quality/deterministic/cyclomatic-complexity
export function manyBranches(type: string, value: number) {
  if (type === 'a') return 1;
  if (type === 'b') return 2;
  if (type === 'c') return 3;
  if (type === 'd' && value > 0) return 4;
  if (type === 'e' || value < 0) return 5;
  if (type === 'f') return 6;
  if (type === 'g') return 7;
  if (type === 'h') return 8;
  if (type === 'i') return 9;
  if (type === 'j') return 10;
  if (type === 'k') return 11;
  return 0;
}

// VIOLATION: code-quality/deterministic/max-nesting-depth
export function deeplyNested(a: boolean, b: boolean, c: boolean, d: boolean, e: boolean) {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          if (e) {
            return 'very deep';
          }
        }
      }
    }
  }
  return 'shallow';
}

// VIOLATION: code-quality/deterministic/max-statements-per-function
export function tooManyStatements() {
  const a = 1; const b = 2; const c = 3; const d = 4; const e = 5;
  const f = 6; const g = 7; const h = 8; const i = 9; const j = 10;
  const k = 11; const l = 12; const m = 13; const n = 14; const o = 15;
  const p = 16; const q = 17; const r = 18; const s = 19; const t = 20;
  const u = 21; const v = 22; const w = 23; const x = 24; const y = 25;
  const z = 26; const aa = 27; const bb = 28; const cc = 29; const dd = 30;
  const ee = 31;
  return a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s+t+u+v+w+x+y+z+aa+bb+cc+dd+ee;
}

// VIOLATION: code-quality/deterministic/too-many-branches
export function manyIfElse(x: number) {
  if (x === 1) return 'a';
  else if (x === 2) return 'b';
  else if (x === 3) return 'c';
  else if (x === 4) return 'd';
  else if (x === 5) return 'e';
  else if (x === 6) return 'f';
  else if (x === 7) return 'g';
  else if (x === 8) return 'h';
  else if (x === 9) return 'i';
  else if (x === 10) return 'j';
  else if (x === 11) return 'k';
  else return 'other';
}

// VIOLATION: code-quality/deterministic/too-many-breaks
export function lotsOfBreaks(items: string[]) {
  for (const item of items) {
    if (item === 'a') break;
    if (item === 'b') break;
    if (item === 'c') break;
    if (item === 'd') break;
    if (item === 'e') break;
    if (item === 'f') break;
  }
  return 'done';
}

// VIOLATION: code-quality/deterministic/too-many-return-statements
export function manyReturns(x: number) {
  if (x === 1) return 'one';
  if (x === 2) return 'two';
  if (x === 3) return 'three';
  if (x === 4) return 'four';
  if (x === 5) return 'five';
  if (x === 6) return 'six';
  return 'other';
}

// VIOLATION: code-quality/deterministic/too-many-switch-cases
export function bigSwitch(x: number) {
  switch (x) {
    case 1: return 'a'; case 2: return 'b'; case 3: return 'c';
    case 4: return 'd'; case 5: return 'e'; case 6: return 'f';
    case 7: return 'g'; case 8: return 'h'; case 9: return 'i';
    case 10: return 'j'; case 11: return 'k';
    default: return 'other';
  }
}

// VIOLATION: code-quality/deterministic/too-many-lines
export function longFunction(x: number) {
  // line 1
  const a = x + 1;
  // line 2
  const b = x + 2;
  // line 3
  const c = x + 3;
  // line 4
  const d = x + 4;
  // line 5
  const e = x + 5;
  // line 6
  const f = x + 6;
  // line 7
  const g = x + 7;
  // line 8
  const h = x + 8;
  // line 9
  const i = x + 9;
  // line 10
  const j = x + 10;
  // line 11
  const k = x + 11;
  // line 12
  const l = x + 12;
  // line 13
  const m = x + 13;
  // line 14
  const n = x + 14;
  // line 15
  const o = x + 15;
  // line 16
  const p = x + 16;
  // line 17
  const q = x + 17;
  // line 18
  const r = x + 18;
  // line 19
  const s = x + 19;
  // line 20
  const t = x + 20;
  // line 21
  const u = x + 21;
  // line 22
  const v = x + 22;
  // line 23
  const w = x + 23;
  // line 24
  const y = x + 24;
  // line 25
  const z = x + 25;
  return a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s+t+u+v+w+x+y+z;
}

// VIOLATION: code-quality/deterministic/too-many-classes-per-file
class ClassA { value = 1; }
class ClassB { value = 2; }
class ClassC { value = 3; }
class ClassD { value = 4; }
export { ClassA, ClassB, ClassC, ClassD };

// VIOLATION: code-quality/deterministic/static-method-candidate
export class Calculator {
  calculate(a: number, b: number) {
    return a + b;
  }
}

// VIOLATION: code-quality/deterministic/ungrouped-accessor-pair
export class PropertyStore {
  private _name = '';
  private _age = 0;
  get name() { return this._name; }
  get age() { return this._age; }
  set age(val: number) { this._age = val; }
  set name(val: string) { this._name = val; }
}

// VIOLATION: code-quality/deterministic/unused-private-method
export class ServiceWorker {
  private helperMethod() {
    return 42;
  }
  getValue() {
    return 0;
  }
}

// VIOLATION: code-quality/deterministic/unused-private-nested-class
export class Container {
  private NestedHelper = class {
    compute() { return 42; }
  };
  getValue() {
    return 0;
  }
}
