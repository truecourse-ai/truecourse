/**
 * Per-language tree-sitter node-type table. The inline-ternary fact extractors
 * (entity-facts, state-machine-facts, formula-facts, handler-facts) index this
 * by `s.lang` instead of branching `s.lang === 'python' ? 'attribute' : …`.
 * Adding a language = a new key here, not a third ternary arm (which would
 * silently mis-parse if forgotten — see docs/CSHARP_SUPPORT_PLAN.md §5).
 */

import type { SupportedLanguage } from '@truecourse/shared';

export interface LangNodeTypes {
  /** Call / invocation node. */
  call: string;
  /** `<obj>.<prop>` member-access node. */
  member: string;
  /** Field name on `member` for the OBJECT (receiver) half. */
  memberObjectField: string;
  /** Field name on `member` for the PROPERTY / method half. */
  memberNameField: string;
  /** Assignment statement / expression node. */
  assign: string;
  /** String literal node type. */
  string: string;
  /** Integer / floating literal node types (C# splits int / real). */
  number: string[];
  /** Object / dict literal node (value side of a construction). */
  object: string;
  /** Array / list literal node. */
  array: string;
  /** Function / method boundary node types (for upward walks). */
  fnBoundary: string[];
  /** Conditional node. */
  ifStatement: string;
  /** Block / statement-block node. */
  block: string;
}

const TS: LangNodeTypes = {
  call: 'call_expression',
  member: 'member_expression',
  memberObjectField: 'object',
  memberNameField: 'property',
  assign: 'assignment_expression',
  string: 'string',
  number: ['number'],
  object: 'object',
  array: 'array',
  fnBoundary: ['function_declaration', 'arrow_function', 'function_expression', 'method_definition'],
  ifStatement: 'if_statement',
  block: 'statement_block',
};

export const NODE_TYPES: Record<SupportedLanguage, LangNodeTypes> = {
  typescript: TS,
  tsx: TS,
  javascript: TS,
  python: {
    call: 'call',
    member: 'attribute',
    memberObjectField: 'object',
    memberNameField: 'attribute',
    assign: 'assignment',
    string: 'string',
    number: ['integer', 'float'],
    object: 'dictionary',
    array: 'list',
    fnBoundary: ['function_definition'],
    ifStatement: 'if_statement',
    block: 'block',
  },
  csharp: {
    call: 'invocation_expression',
    member: 'member_access_expression',
    memberObjectField: 'expression',
    memberNameField: 'name',
    assign: 'assignment_expression',
    string: 'string_literal',
    number: ['integer_literal', 'real_literal'],
    // The fixture (and idiomatic modern C#) uses target-typed `new()` / `new[]{}`,
    // which parse as the *implicit* variants. Matchers must accept both forms.
    object: 'object_creation_expression',
    array: 'array_creation_expression',
    fnBoundary: ['method_declaration', 'local_function_statement', 'lambda_expression'],
    ifStatement: 'if_statement',
    block: 'block',
  },
};
