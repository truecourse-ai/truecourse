/**
 * Bug violations related to control flow.
 */

// VIOLATION: bugs/deterministic/constant-condition
export function constantConditionExample() {
  if (false) {
    return 'dead code';
  }
  return 'ok';
}

// VIOLATION: bugs/deterministic/unreachable-code
export function unreachableCodeExample() {
  return 'done';
  const x = 42;
  return x;
}

// VIOLATION: bugs/deterministic/all-branches-identical
export function allBranchesIdenticalExample(x: number) {
  if (x > 0) {
    return 'same';
  } else {
    return 'same';
  }
}

// VIOLATION: bugs/deterministic/duplicate-else-if
export function duplicateElseIfExample(x: number) {
  if (x > 10) {
    return 'big';
  } else if (x > 5) {
    return 'medium';
  } else if (x > 10) {
    return 'also big';
  }
  return 'small';
}

// VIOLATION: bugs/deterministic/duplicate-branches
export function duplicateBranchesExample(x: number) {
  if (x > 10) {
    console.log('hello');
    return x * 2;
  } else if (x > 5) {
    console.log('hello');
    return x * 2;
  }
  return x;
}

// VIOLATION: bugs/deterministic/assignment-in-condition
export function assignmentInConditionExample() {
  let x = 0;
  if (x = 5) {
    return x;
  }
  return 0;
}

// VIOLATION: bugs/deterministic/for-direction
export function forDirectionExample() {
  const arr: number[] = [];
  for (let i = 0; i < 10; i--) {
    arr.push(i);
  }
  return arr;
}

// VIOLATION: bugs/deterministic/unreachable-loop
export function unreachableLoopExample() {
  for (let i = 0; i < 10; i++) {
    return i;
  }
}

// VIOLATION: bugs/deterministic/unmodified-loop-condition
export function unmodifiedLoopConditionExample() {
  let done = false;
  while (done === false) {
    const x = 1 + 2;
  }
}

// VIOLATION: bugs/deterministic/loop-counter-assignment
export function loopCounterAssignmentExample() {
  for (let i = 0; i < 10; i++) {
    i = 5;
    console.log(i);
  }
}

// VIOLATION: bugs/deterministic/fallthrough-case
export function fallthroughCaseExample(x: number) {
  switch (x) {
    case 1:
      console.log('one');
    case 2:
      console.log('two');
      break;
    case 3:
      console.log('three');
      break;
  }
}
