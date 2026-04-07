/**
 * Model validation utilities — contains various control flow and comparison bugs.
 */

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function validateAge(age: number) {
  // VIOLATION: bugs/deterministic/constant-condition
  if (false) {
    return 'dead code';
  }
  return age >= 0 && age <= 150;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function getDisplayName(user: { name: string; nickname?: string }) {
  return user.nickname || user.name;
  // VIOLATION: bugs/deterministic/unreachable-code
  const x = 42;
  return x;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function categorize(value: number) {
  // VIOLATION: bugs/deterministic/all-branches-identical
  if (value > 0) {
    return 'positive';
  } else {
    return 'positive';
  }
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function classifyScore(score: number) {
  // VIOLATION: bugs/deterministic/duplicate-else-if
  if (score > 90) {
    return 'excellent';
  } else if (score > 70) {
    return 'good';
  } else if (score > 90) {
    return 'also excellent';
  }
  return 'average';
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function processRange(x: number) {
  // VIOLATION: bugs/deterministic/duplicate-branches
  if (x > 10) {
    console.log('processing');
    return x * 2;
  } else if (x > 5) {
    console.log('processing');
    return x * 2;
  }
  return x;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function checkFlags() {
  let x = 0;
  // VIOLATION: bugs/deterministic/assignment-in-condition
  if (x = 5) {
    return x;
  }
  return 0;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function fillArray() {
  const arr: number[] = [];
  // VIOLATION: bugs/deterministic/for-direction
  for (let i = 0; i < 10; i--) {
    arr.push(i);
  }
  return arr;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function firstItem() {
  // VIOLATION: bugs/deterministic/unreachable-loop
  for (let i = 0; i < 10; i++) {
    return i;
  }
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function waitForDone() {
  let done = false;
  // VIOLATION: bugs/deterministic/unmodified-loop-condition
  while (done === false) {
    const x = 1 + 2;
  }
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function brokenLoop() {
  // VIOLATION: bugs/deterministic/loop-counter-assignment
  for (let i = 0; i < 10; i++) {
    i = 5;
    console.log(i);
  }
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function handleStatus(status: number) {
  // VIOLATION: bugs/deterministic/fallthrough-case
  switch (status) {
    case 200:
      console.log('ok');
    case 301:
      console.log('redirect');
      break;
    case 404:
      console.log('not found');
      break;
  }
}
