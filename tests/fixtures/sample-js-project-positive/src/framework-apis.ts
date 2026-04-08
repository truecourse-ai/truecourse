/**
 * Framework API patterns that should NOT trigger any rules.
 *
 * Star imports for React are idiomatic.
 * Relative namespace imports are allowed.
 * parseInt with radix argument satisfies the missing-radix rule.
 * Drizzle style eq function calls.
 */

import * as React from 'react';
import * as helpers from './helpers';

export function parsePageNumber(input: string): number {
  return parseInt(input, 10);
}

export function parseHexColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

interface Column {
  name: string;
}

interface WhereClause {
  column: Column;
  value: string;
}

function eq(column: Column, value: string): WhereClause {
  return { column, value };
}

export function buildQuery(userId: string): WhereClause {
  const usersTable = { id: { name: 'id' } };
  return eq(usersTable.id, userId);
}

export function getReactVersion(): unknown {
  return React;
}

export function getHelperCount(): number {
  return Object.keys(helpers).length;
}
