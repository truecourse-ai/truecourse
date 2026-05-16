import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const FUNCTION_SCOPE_TYPES = new Set<string>([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
  'generator_function',
])

/**
 * Walk up the parent chain until we hit a function-like scope or the
 * program root. The returned node bounds the search for sibling casts.
 */
function findEnclosingScope(node: SyntaxNode): SyntaxNode {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (FUNCTION_SCOPE_TYPES.has(cur.type) || cur.type === 'program') {
      return cur
    }
    cur = cur.parent
  }
  return node
}

/**
 * Collect every `as_expression` descendant of `scope` whose expression
 * (the left-hand-side of `as`) is an identifier. Returns a map from
 * identifier text to the matching cast nodes.
 */
function collectIdentifierCasts(scope: SyntaxNode): Map<string, SyntaxNode[]> {
  const byIdent = new Map<string, SyntaxNode[]>()
  const stack: SyntaxNode[] = [scope]
  while (stack.length > 0) {
    const cur = stack.pop()!
    // Don't descend into a NESTED function scope — we only want casts in the
    // immediate scope (otherwise inner-function casts pollute the count).
    if (cur !== scope && FUNCTION_SCOPE_TYPES.has(cur.type)) continue

    if (cur.type === 'as_expression') {
      const lhs = cur.namedChildren[0]
      if (lhs && lhs.type === 'identifier') {
        const name = lhs.text
        let list = byIdent.get(name)
        if (!list) {
          list = []
          byIdent.set(name, list)
        }
        list.push(cur)
      }
    }

    for (let i = cur.namedChildCount - 1; i >= 0; i--) {
      const child = cur.namedChild(i)
      if (child) stack.push(child)
    }
  }
  return byIdent
}

/**
 * type-assertion-overuse — the "shotgun assertion" pattern.
 *
 * Fires only when the same source identifier is cast two or more times in
 * the same function scope AND the current cast is `as any`. This is the
 * canonical overuse shape (e.g. `const a = x as any; const b = x as T; ...`)
 * where the author is blanket-casting a single value to several
 * incompatible types instead of narrowing it. Single, isolated casts are
 * the standard escape hatch for library type gaps and are skipped.
 *
 * Additional skips:
 *  • member-access casts `(x as any).field` (one-shot property/method
 *    look-ups, prototype patching, namespace augmentation),
 *  • the inner cast of a double-cast `x as any as T` (canonical pun),
 *  • typed stub initialisers `null as any` / `{} as any` / `[] as any`
 *    (form/control placeholders bootstrapped at runtime),
 *  • casts suppressed at source with an `eslint-disable` for
 *    `@typescript-eslint/no-explicit-any` or
 *    `@typescript-eslint/consistent-type-assertions`.
 */
export const typeAssertionOveruseVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/type-assertion-overuse',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['as_expression'],
  visit(node, filePath, sourceCode) {
    const typeNode = node.namedChildren[node.namedChildren.length - 1]
    if (!typeNode) return null

    if (typeNode.text !== 'any') return null

    // Heuristic 1: skip member-access casts like `(x as any).field`.
    const parent = node.parent
    if (parent && parent.type === 'parenthesized_expression') {
      const grand = parent.parent
      if (
        grand &&
        (grand.type === 'member_expression' ||
          grand.type === 'subscript_expression')
      ) {
        return null
      }
    }

    // Heuristic 2: skip the inner cast of `x as any as T`. The outer cast
    // restores a concrete target type — the inner `as any` is the canonical
    // TypeScript pun for forcing an incompatible value through the type
    // system, equivalent to `unknown` bridging.
    if (parent && parent.type === 'as_expression') return null

    // Heuristic 3: skip canonical typed-stub initialisers — `null as any`,
    // `{} as any`, `[] as any`. These appear as form-control placeholders
    // and Zod default state where the consuming type comes from the
    // surrounding annotation, not from the cast itself.
    const expr = node.namedChildren[0]
    if (expr) {
      const exprText = expr.text
      if (exprText === 'null' || exprText === '{}' || exprText === '[]') {
        return null
      }
    }

    // Heuristic 4: respect explicit author opt-outs via `eslint-disable`
    // directives covering the canonical TypeScript-ESLint rules. The
    // directive may be on the same line, the line above, or up to four
    // lines above (allowing for explanatory comments in between).
    const sourceLines = sourceCode.split('\n')
    const nodeStartLine = node.startPosition.row
    const windowStart = Math.max(0, nodeStartLine - 4)
    for (let i = windowStart; i <= nodeStartLine; i++) {
      const line = sourceLines[i] ?? ''
      if (
        line.includes('eslint-disable') &&
        (line.includes('@typescript-eslint/no-explicit-any') ||
          line.includes('@typescript-eslint/consistent-type-assertions'))
      ) {
        return null
      }
    }

    // Core check: require the "shotgun assertion" shape — the same source
    // identifier cast two or more times in the same function scope. The
    // left-hand side of the current cast must be a plain identifier (call
    // expressions, member accesses, literals, and other compound shapes
    // are routine and skipped).
    if (!expr || expr.type !== 'identifier') return null

    const scope = findEnclosingScope(node)
    const byIdent = collectIdentifierCasts(scope)
    const casts = byIdent.get(expr.text) ?? []
    if (casts.length < 2) return null

    // Require the same identifier to be cast to TWO OR MORE distinct
    // target types. The "shotgun" anti-pattern is forcing one value into
    // several incompatible shapes; repeating the SAME cast (e.g. casting
    // a handler to `any` twice to satisfy strict DOM overloads) is the
    // textbook idiomatic workaround and not overuse.
    const distinctTypes = new Set<string>()
    for (const cast of casts) {
      const t = cast.namedChildren[cast.namedChildren.length - 1]
      if (t) distinctTypes.add(t.text)
    }
    if (distinctTypes.size < 2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Type assertion to any',
      "'as any' bypasses TypeScript's type system entirely. Use proper type narrowing instead.",
      sourceCode,
      'Use type guards, generics, or proper type narrowing instead of "as any".',
    )
  },
}
