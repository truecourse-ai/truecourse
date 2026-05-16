import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SENSITIVE_COMPARISON_PATTERNS = /(?:token|secret|hmac|signature|apikey|api_key|hash|digest|password|passwd)/i

// Property names that are categorical / metadata — comparing these is not a secret comparison.
const NON_SECRET_PROPERTY_NAMES = new Set([
  'length',
  'id',
  'name',
  'kind',
  'type',
  'scope',
  'role',
  'status',
  'email',
  'pathname',
  'key',
])

// Array iteration helpers whose arrow-callback bodies are data lookup/filter wiring,
// not auth gates.
const ARRAY_LOOKUP_CALLEES = new Set([
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'filter',
  'some',
  'every',
  'map',
])

// Zod-style refine/superRefine callbacks — schema validation, not a runtime auth oracle.
const SCHEMA_REFINE_CALLEES = new Set(['refine', 'superRefine'])

/** Strip surrounding quotes from a tree-sitter string node's text. */
function stringLiteralValue(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null
  const t = node.text
  if (t.length < 2) return ''
  return t.slice(1, -1)
}

/** Returns true if the node is a numeric, true/false/null/undefined literal, or `typeof X`. */
function isPrimitiveOrTypeofExpr(node: SyntaxNode): boolean {
  switch (node.type) {
    case 'number':
    case 'true':
    case 'false':
    case 'null':
    case 'undefined':
      return true
    case 'unary_expression': {
      // typeof X
      const op = node.children.find((c) => c.type === 'typeof' || c.text === 'typeof')
      if (op) return true
      // also -1 etc. → unary_expression wrapping a number
      const arg = node.childForFieldName('argument')
      if (arg && arg.type === 'number') return true
      return false
    }
    case 'identifier':
      return node.text === 'undefined'
    default:
      return false
  }
}

/** Whether a string literal looks like an enum value (UPPER_SNAKE_CASE) or a route/path id. */
function isCategoricalStringLiteral(text: string): boolean {
  if (text === '') return true
  // UPPER_SNAKE_CASE / SCREAMING_SNAKE — clearly enum-like
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) return true
  // PascalCase exception-like names ('PasswordException')
  if (/^[A-Z][A-Za-z0-9]+(?:Exception|Error)$/.test(text)) return true
  // Route-id-style ('_recipient._layout.contracts.$token.rejected') or paths
  if (text.includes('/') || text.includes('+') || text.includes('$')) return true
  // Short single-word discriminator labels (e.g. 'typed', 'draw', 'signature', 'primary').
  // A real secret/token is much longer and includes a mix of cases/digits/symbols.
  if (text.length <= 24 && /^[A-Za-z][A-Za-z0-9-]*$/.test(text)) return true
  return false
}

/** Return the final property name from a member_expression (e.g. `a.b.c` → `c`). */
function trailingPropertyName(node: SyntaxNode): string | null {
  if (node.type !== 'member_expression') return null
  const prop = node.childForFieldName('property')
  return prop?.text ?? null
}

/** Whether the trailing property of a member_expression looks like an enum constant. */
function endsInEnumLikeProperty(node: SyntaxNode): boolean {
  const prop = trailingPropertyName(node)
  if (!prop) return false
  // Enum members tend to be UPPER_SNAKE_CASE (FieldType.SIGNATURE, RecipientKind.ASSISTANT).
  return /^[A-Z][A-Z0-9_]*$/.test(prop)
}

/** Whether the trailing property name is in our non-secret/categorical set. */
function endsInNonSecretProperty(node: SyntaxNode): boolean {
  const prop = trailingPropertyName(node)
  if (!prop) return false
  if (NON_SECRET_PROPERTY_NAMES.has(prop)) return true
  // Numeric foreign-key properties (`.userId`, `.teamId`, `.recipientId`, `.tokenId`)
  // are integer DB primary keys, not cryptographic secrets.
  if (/Id$/.test(prop) && /^[a-z]/.test(prop)) return true
  return false
}

/**
 * Walk up the AST looking for an enclosing arrow/function that is the immediate
 * argument of `arr.find(...)`, `arr.filter(...)`, `zod.refine(...)`, etc.
 * Returns the callee property name if found, else null.
 */
function enclosingArrayOrSchemaCallback(node: SyntaxNode): string | null {
  let cur: SyntaxNode | null = node.parent
  let prev: SyntaxNode | null = node
  while (cur) {
    if (cur.type === 'arrow_function' || cur.type === 'function_expression' || cur.type === 'function_declaration') {
      // is this function the argument of a method call?
      const parent = cur.parent
      if (parent && parent.type === 'arguments') {
        const callExpr = parent.parent
        if (callExpr && callExpr.type === 'call_expression') {
          const callee = callExpr.childForFieldName('function')
          if (callee && callee.type === 'member_expression') {
            const prop = callee.childForFieldName('property')?.text
            if (prop && (ARRAY_LOOKUP_CALLEES.has(prop) || SCHEMA_REFINE_CALLEES.has(prop))) {
              return prop
            }
          }
        }
      }
      // Function boundary that's not a relevant callback — stop searching.
      return null
    }
    prev = cur
    cur = cur.parent
  }
  void prev
  return null
}

/**
 * Returns true if a side of the comparison is clearly NOT a secret value:
 *  - primitive literal (number / boolean / null / undefined)
 *  - typeof X expression
 *  - empty string '' or enum-style literal 'SIGNATURE'
 *  - member access ending in an UPPER_SNAKE property (FieldType.SIGNATURE)
 *  - member access ending in a categorical property (`.id`, `.type`, `.length`, ...)
 */
function isNonSecretSide(node: SyntaxNode): boolean {
  if (isPrimitiveOrTypeofExpr(node)) return true
  const str = stringLiteralValue(node)
  if (str !== null) {
    if (isCategoricalStringLiteral(str)) return true
    return false
  }
  if (node.type === 'member_expression') {
    if (endsInEnumLikeProperty(node)) return true
    if (endsInNonSecretProperty(node)) return true
  }
  return false
}

export const timingAttackComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/timing-attack-comparison',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.type === '===' || c.type === '!==')

    if (!operator || !left || !right) return null

    const leftText = left.text
    const rightText = right.text

    // Only consider comparisons where at least one side textually references a sensitive
    // identifier — same coarse filter as before.
    if (!SENSITIVE_COMPARISON_PATTERNS.test(leftText) && !SENSITIVE_COMPARISON_PATTERNS.test(rightText)) {
      return null
    }

    // File-level escape hatch: if timingSafeEqual is already used, the remaining ===
    // comparisons are likely format/identity checks, not secret comparisons.
    if (sourceCode.includes('timingSafeEqual')) return null

    // If either side is clearly non-secret (literal, typeof, enum member, categorical
    // property like `.id`/`.length`/`.type`), this is not a timing-attack comparison.
    if (isNonSecretSide(left) || isNonSecretSide(right)) return null

    // If the comparison sits inside an array-lookup callback (`.find`, `.filter`, …)
    // or a Zod `.refine` callback, it's data-wiring / schema validation rather than
    // an auth oracle.
    if (enclosingArrayOrSchemaCallback(node)) return null

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'medium',
      'Timing attack via string comparison',
      `Using ${operator.text} to compare what may be a secret/token. This is vulnerable to timing attacks.`,
      sourceCode,
      'Use crypto.timingSafeEqual() for comparing secrets and tokens.',
    )
  },
}
