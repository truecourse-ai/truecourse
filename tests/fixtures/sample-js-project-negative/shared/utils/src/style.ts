/**
 * Style violations — formatting, naming, import organization.
 */

// VIOLATION: style/deterministic/sorting-style
import { writeFileSync, readFileSync } from 'fs';

// VIOLATION: style/deterministic/import-formatting
import {createServer} from 'http';

// VIOLATION: style/deterministic/js-naming-convention
export const my_variable = 42;
export function My_Function() {
  return my_variable;
}

// VIOLATION: style/deterministic/whitespace-formatting
export function   badSpacing  (  x: number  ) {
  return x;
}

// VIOLATION: style/deterministic/comment-tag-formatting
// todo: fix this later
export function placeholder() {
  return null;
}

// VIOLATION: style/deterministic/ts-declaration-style
export type UserID = string;

// VIOLATION: style/deterministic/js-style-preference
export function noSemicolon() {
  const x = 42
  return x
}

export { writeFileSync, readFileSync, createServer };
