/**
 * CodeMirror StreamLanguage for `.tc` (TrueCourse Intent IL).
 *
 * This is a parallel implementation of the TextMate grammar shipped
 * to VS Code under
 *   `tools/cli/vscode-extension/syntaxes/tc.tmLanguage.json`.
 *
 * Two grammars exist because the two editor stacks speak different
 * formats:
 *   - VS Code  → TextMate grammar (oniguruma regex engine)
 *   - CodeMirror → Lezer / StreamLanguage (custom JS tokenizer)
 *
 * The CodeMirror side maps each `.tc` token to a standard
 * `@lezer/highlight` tag; the dashboard's existing CodeMirror theme
 * (`@uiw/codemirror-theme-vscode`) colors those tags. End result: a
 * dashboard `.tc` file looks visually equivalent to the same file in
 * VS Code under the default Dark+ / Light+ themes.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  KEEP IN SYNC with `tc.tmLanguage.json`.
 *  Keyword lists, HTTP methods, status conditions, and types are
 *  hand-mirrored from the TextMate grammar. If you add a new artifact
 *  kind or section keyword there, add it here too.
 * ─────────────────────────────────────────────────────────────────────
 */

import { StreamLanguage, type StreamParser } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const ARTIFACT_DECL = new Set([
  'operation',
  'entity',
  'enum',
  'state-machine',
  'auth-requirement',
  'authorization-rule',
  'error-envelope',
  'pagination-contract',
  'idempotency-contract',
  'effect-group',
  'unenforceable-obligation',
  'formula',
]);

const SECTION_KEYWORDS = new Set([
  'origin', 'request', 'response', 'body', 'header', 'query', 'path-param',
  'effect', 'emits', 'persist', 'state-transition', 'forbid', 'forbids',
  'inherits', 'selector', 'applies-to', 'on-violation', 'preconditions',
  'payload-shape', 'payload-constraint', 'emit-when', 'on-status', 'channel',
  'known-codes', 'response-shape', 'spec-text', 'category', 'rationale',
  'could-become-enforceable-via', 'transitions', 'states', 'initial',
  'terminal', 'field', 'tags', 'writes', 'invariant-after', 'on-invalid',
  'element', 'sort', 'direction', 'scope', 'representation', 'values',
  'shape', 'error', 'on-above-max', 'when-response-status', 'semantics',
  'format', 'normalize', 'references', 'bound-to', 'required-role',
  'scheme', 'predicate', 'expression', 'inputs', 'output', 'depends-on',
  'computed-at', 'immutable-after-creation', 'derived-by', 'applies',
  'except', 'loaded',
]);

const RESPONSE_CONDITIONS = new Set([
  'success', 'validation_failure', 'not_found', 'conflict',
  'state_precondition_violated', 'auth_required', 'auth_role_failed',
  'idempotency_replay', 'rate_limited', 'internal_error',
]);

const CONTROL_KEYWORDS = new Set([
  'on', 'to', 'from', 'now', 'machine', 'resource', 'when', 'then', 'else',
  'status',
]);

const STORAGE_MODIFIERS = new Set([
  'required', 'optional', 'immutable', 'mutable', 'unique', 'closed',
  'paginated', 'idempotent', 'admin-only', 'admin', 'public', 'true',
  'false', 'clamp', 'opaque', 'null-when-last-page', 'machine-identifier',
  'human-readable', 'shape-depends-on-code', 'non-empty', 'server-assigned',
  'derived', 'refreshed-on-mutation', 'lowercase', 'idempotent-under',
  'short-circuit-on-repeat', 'resource-missing', 'cursor', 'event-bus',
  'string-literal', 'global', 'desc', 'asc', 'Bearer', 'Role',
]);

const OPERATOR_MODIFIERS = new Set([
  'one-of', 'any-of', 'all-of', 'none-of', 'not', 'default', 'min', 'max',
  'mutability', 'constraint',
]);

const COMPOUND_SELECTORS = new Set([
  'path-glob', 'path-regex', 'method', 'protocol', 'tag', 'operations',
  'status-class',
]);

const PRIMITIVE_TYPES = new Set([
  'string', 'integer', 'number', 'boolean', 'object', 'array',
]);

const FORMAT_TYPES = new Set([
  'uuid', 'email', 'iso-8601',
]);

const HTTP_METHODS = new Set([
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
]);

const ARTIFACT_REFS = new Set([
  'Entity', 'Operation', 'StateMachine', 'Effect', 'EffectGroup',
  'AuthRequirement', 'AuthorizationRule', 'ErrorEnvelope',
  'PaginationContract', 'IdempotencyContract', 'UnenforceableObligation',
  'Enum', 'Formula', 'PerformanceSLA',
]);

interface TcState {
  /** True when inside an unterminated `/* … *​/` block comment. */
  inBlockComment: boolean;
  /** True when inside a `"…"` string. */
  inString: boolean;
}

/**
 * Identifier matcher — supports dashes (effect-group), dots
 * (order.placed), and digits after the first char.
 */
const IDENT_RE = /^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*/;

const tcStreamParser: StreamParser<TcState> = {
  name: 'tc',
  startState() {
    return { inBlockComment: false, inString: false };
  },
  token(stream, state) {
    // Block comment continuation.
    if (state.inBlockComment) {
      if (stream.match(/.*?\*\//)) {
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return t.blockComment.toString();
    }

    // String continuation.
    if (state.inString) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\' && !stream.eol()) {
          stream.next();
          continue;
        }
        if (ch === '"') {
          state.inString = false;
          return t.string.toString();
        }
      }
      return t.string.toString();
    }

    if (stream.eatSpace()) return null;

    // Comments
    if (stream.match('//')) {
      stream.skipToEnd();
      return t.lineComment.toString();
    }
    if (stream.match('/*')) {
      if (stream.match(/.*?\*\//)) return t.blockComment.toString();
      state.inBlockComment = true;
      stream.skipToEnd();
      return t.blockComment.toString();
    }

    // Strings
    if (stream.match('"')) {
      state.inString = true;
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\' && !stream.eol()) {
          stream.next();
          continue;
        }
        if (ch === '"') {
          state.inString = false;
          return t.string.toString();
        }
      }
      return t.string.toString();
    }

    // Numbers — ranges (12..-3 or 12..30) take priority over plain.
    if (stream.match(/^-?\d+\.\.-?\d+/)) return t.number.toString();
    if (stream.match(/^\d{1}xx/)) return t.number.toString();
    if (stream.match(/^-?\d+/)) return t.number.toString();

    // Operators
    if (stream.match('->')) return t.operator.toString();
    if (stream.match('..')) return t.operator.toString();
    if (stream.match(/^(>=|<=|==|!=)/)) return t.operator.toString();
    if (stream.match(/^[<>]/)) return t.operator.toString();
    if (stream.match('=')) return t.operator.toString();
    if (stream.match('|')) return t.operator.toString();

    // Punctuation
    if (stream.match(':')) return t.punctuation.toString();
    if (stream.match(',')) return t.separator.toString();
    if (stream.match('{') || stream.match('}')) return t.brace.toString();
    if (stream.match('[') || stream.match(']')) return t.bracket.toString();

    // Identifiers / keywords / refs
    const idMatch = stream.match(IDENT_RE) as RegExpMatchArray | false;
    if (idMatch) {
      const word = idMatch[0];

      // Artifact reference: `Entity:Customer`, `Operation:"…"`, etc.
      // The capital-letter kind name precedes a `:` that we'll lex
      // on the next pass.
      if (ARTIFACT_REFS.has(word) && stream.peek() === ':') {
        return t.typeName.toString();
      }

      if (ARTIFACT_DECL.has(word)) return t.definitionKeyword.toString();
      if (SECTION_KEYWORDS.has(word)) return t.controlKeyword.toString();
      if (RESPONSE_CONDITIONS.has(word)) return t.atom.toString();
      if (CONTROL_KEYWORDS.has(word)) return t.controlKeyword.toString();
      if (STORAGE_MODIFIERS.has(word)) return t.modifier.toString();
      if (OPERATOR_MODIFIERS.has(word)) return t.operatorKeyword.toString();
      if (COMPOUND_SELECTORS.has(word)) return t.special(t.variableName).toString();
      if (PRIMITIVE_TYPES.has(word)) return t.typeName.toString();
      if (FORMAT_TYPES.has(word)) return t.typeName.toString();
      if (HTTP_METHODS.has(word)) return t.atom.toString();

      return t.variableName.toString();
    }

    // Unknown — advance one char to avoid an infinite loop.
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    indentOnInput: /^\s*[}\]]/,
  },
};

export function tc() {
  return StreamLanguage.define(tcStreamParser);
}
