/**
 * Bug violations related to assignments and reassignments.
 */

// VIOLATION: bugs/deterministic/self-assignment
export function selfAssignmentExample(obj: { name: string }) {
  obj.name = obj.name;
  return obj;
}

// VIOLATION: bugs/deterministic/const-reassignment
const MAX_VALUE = 100;
// @ts-ignore
MAX_VALUE = 200;

// VIOLATION: bugs/deterministic/import-reassignment
import { EventEmitter } from 'events';
// @ts-ignore
EventEmitter = null;

// VIOLATION: bugs/deterministic/function-reassignment
function myFunc() {
  return 42;
}
// @ts-ignore
myFunc = () => 99;

// VIOLATION: bugs/deterministic/class-reassignment
class MyClass {
  value = 1;
}
// @ts-ignore
MyClass = class { value = 2 };
