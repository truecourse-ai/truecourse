import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

const MAX_DEPTH = 4

const NESTING_TYPES = new Set([
  'if_statement', 'for_statement', 'for_in_statement', 'while_statement',
  'do_statement', 'try_statement', 'switch_statement', 'with_statement',
])

const FUNCTION_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'function',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
  'generator_function',
])

/**
 * Two structural patterns are intentionally *not* counted as nesting levels:
 *
 *   1. `else if` chain head — in tree-sitter, `if A {} else if B {}` parses
 *      as `if_statement(A, else_clause(if_statement(B)))`. The inner
 *      `if_statement(B)` is the head of an `else if` branch (its direct
 *      parent is `else_clause`) and is part of the same logical decision
 *      point as the outer if. Counting it would inflate flat dispatch chains
 *      on discriminated unions.
 *
 *   2. Trivial guard chain — a sequence of nestings where each level's body
 *      contains *only* the next nesting statement and the level has no
 *      `else` branch. e.g.
 *        `if (a) { if (b) { if (c) { return X; } } }`
 *      Each level is a pure guard with no alternative; the whole chain can
 *      be expressed as a single combined condition or as a sequence of
 *      early-return guards. Counting each level overstates nesting and
 *      duplicates what `collapsible-if` already reports.
 */
function isElseIfHead(node: SyntaxNode): boolean {
  return node.type === 'if_statement' && node.parent?.type === 'else_clause'
}

function hasElseClause(node: SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && c.type === 'else_clause') return true
  }
  return false
}

function getNestingBody(node: SyntaxNode): SyntaxNode | null {
  // The body block of a nesting statement varies by node type:
  //   - if_statement / for / while / do: childForFieldName('body')
  //   - some statements expose 'consequence' for the then-branch
  // Fall back to first statement_block child.
  const named =
    node.childForFieldName('body') ||
    node.childForFieldName('consequence') ||
    null
  if (named && named.type === 'statement_block') return named
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c && c.type === 'statement_block') return c
  }
  return null
}

/**
 * `current` is a nesting statement and `cameFrom` is the immediate child of
 * `current` we ascended through (typically the statement_block body or, for
 * an if-with-else, the body or the else_clause). Returns true iff `current`
 * is part of a trivial guard chain — its body is `{ singleNestingStmt }`
 * AND we came up through that body (not through an else branch) AND it has
 * no `else` of its own.
 */
function isTrivialGuardLevel(current: SyntaxNode, cameFrom: SyntaxNode | null): boolean {
  if (!cameFrom) return false
  if (hasElseClause(current)) return false
  const body = getNestingBody(current)
  if (!body || body.id !== cameFrom.id) return false
  if (body.namedChildCount !== 1) return false
  const onlyChild = body.namedChild(0)
  if (!onlyChild) return false
  return NESTING_TYPES.has(onlyChild.type)
}

function getNestingDepth(node: SyntaxNode): number {
  let depth = 0
  let current: SyntaxNode | null = node.parent
  let cameFrom: SyntaxNode = node
  while (current) {
    if (NESTING_TYPES.has(current.type)) {
      const skipElseIf = isElseIfHead(current)
      const skipTrivial = isTrivialGuardLevel(current, cameFrom)
      if (!skipElseIf && !skipTrivial) {
        depth++
      }
    }
    if (FUNCTION_TYPES.has(current.type)) {
      break
    }
    cameFrom = current
    current = current.parent
  }
  return depth
}

export const maxNestingDepthVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/max-nesting-depth',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    // Skip the head of an `else if` branch — it is not a new nesting level.
    if (isElseIfHead(node)) return null

    const depth = getNestingDepth(node)
    if (depth < MAX_DEPTH) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Block nested ${depth + 1} levels deep`,
      `Block is nested ${depth + 1} levels deep — maximum is ${MAX_DEPTH}. Extract logic into helper functions.`,
      sourceCode,
      'Extract the deeply nested code into a named function.',
    )
  },
}
