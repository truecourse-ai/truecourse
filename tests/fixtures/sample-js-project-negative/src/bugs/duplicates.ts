/**
 * Bug violations related to duplicate declarations.
 */

// VIOLATION: bugs/deterministic/duplicate-case
export function duplicateCaseExample(x: string) {
  switch (x) {
    case 'a':
      return 1;
    case 'b':
      return 2;
    case 'a':
      return 3;
    default:
      return 0;
  }
}

// VIOLATION: bugs/deterministic/duplicate-keys
export function duplicateKeysExample() {
  return {
    name: 'Alice',
    age: 30,
    name: 'Bob',
  };
}

// VIOLATION: bugs/deterministic/duplicate-class-members
export class DuplicateClassMembers {
  greet() {
    return 'hello';
  }
  greet() {
    return 'hi';
  }
}

// VIOLATION: bugs/deterministic/duplicate-enum-value
export enum StatusCode {
  OK = 200,
  Created = 201,
  Success = 200,
}

// VIOLATION: bugs/deterministic/duplicate-import
import { readFileSync } from 'fs';
import { readFileSync as readSync } from 'fs';

export function useDuplicateImport() {
  return readFileSync && readSync;
}
