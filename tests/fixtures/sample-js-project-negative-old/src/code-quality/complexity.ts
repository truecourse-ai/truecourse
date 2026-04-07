/**
 * Code quality violations related to complexity.
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
export function redundantBoolean(x: number) {
  if (x > 0) {
    return true;
  } else {
    return false;
  }
}

// VIOLATION: code-quality/deterministic/unnecessary-else-after-return
export function unnecessaryElseAfterReturn(x: number) {
  if (x > 0) {
    return 'positive';
  } else {
    return 'non-positive';
  }
}

// VIOLATION: code-quality/deterministic/no-empty-function
export function emptyFunction() {
}

// VIOLATION: code-quality/deterministic/no-useless-catch
export function uselessCatch() {
  try {
    return JSON.parse('{}');
  } catch (e) {
    throw e;
  }
}

// VIOLATION: code-quality/deterministic/deeply-nested-functions
export function deeplyNested() {
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
export function nestedSwitch(a: number, b: string) {
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
