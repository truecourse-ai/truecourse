/**
 * Style violations — formatting, naming, import organization.
 */

// VIOLATION: style/deterministic/sorting-style
import { writeFileSync, readFileSync } from 'fs';

const earlyConst = 42;

// VIOLATION: style/deterministic/import-formatting
import { createServer } from 'http';

// VIOLATION: style/deterministic/js-naming-convention
export function my_snake_function() {
  return earlyConst;
}

// VIOLATION: style/deterministic/whitespace-formatting
export function mixedIndent() {
  const a = 1;
	const b = 2;
  return a + b;
}

// VIOLATION: style/deterministic/comment-tag-formatting
// TODO fix this later
export function placeholder() {
  return null;
}

// VIOLATION: style/deterministic/ts-declaration-style
export interface EmptyInterface {}

// VIOLATION: style/deterministic/js-style-preference
var legacyVar = 42;

export { writeFileSync, readFileSync, createServer, legacyVar };
