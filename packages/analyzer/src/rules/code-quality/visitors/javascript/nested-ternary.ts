import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Returns the inner ternary node if `n` is a ternary (or a parenthesized
 * expression that wraps a ternary, possibly with arbitrary nesting). Otherwise null.
 */
function unwrapTernary(n: SyntaxNode | null): SyntaxNode | null {
  if (!n) return null
  let cur: SyntaxNode | null = n
  while (cur && cur.type === 'parenthesized_expression') {
    let inner: SyntaxNode | null = null
    for (let i = 0; i < cur.namedChildCount; i++) {
      const c = cur.namedChild(i)
      if (c) { inner = c; break }
    }
    cur = inner
  }
  if (cur && cur.type === 'ternary_expression') return cur
  return null
}

/**
 * Walks down both the consequence side and the alternative side of a ternary,
 * collecting every ternary in the chain (including itself). Recurses through
 * parenthesized expressions but does NOT descend into unrelated sub-expressions
 * (e.g. function-call arguments) — only the ternary spine.
 */
function collectChain(root: SyntaxNode): SyntaxNode[] {
  const chain: SyntaxNode[] = []
  const stack: SyntaxNode[] = [root]
  while (stack.length > 0) {
    const t = stack.pop()
    if (!t) continue
    chain.push(t)
    const cons = unwrapTernary(t.childForFieldName('consequence'))
    const alt = unwrapTernary(t.childForFieldName('alternative'))
    if (cons) stack.push(cons)
    if (alt) stack.push(alt)
  }
  return chain
}

/**
 * Strip parenthesized_expression wrapper(s) from a node.
 */
function stripParens(n: SyntaxNode | null): SyntaxNode | null {
  let cur: SyntaxNode | null = n
  while (cur && cur.type === 'parenthesized_expression') {
    let inner: SyntaxNode | null = null
    for (let i = 0; i < cur.namedChildCount; i++) {
      const c = cur.namedChild(i)
      if (c) { inner = c; break }
    }
    cur = inner
  }
  return cur
}

/**
 * Returns true if `cond` is a relational-comparison binary expression at its
 * root (after stripping parens) — i.e. `<expr> [< | > | <= | >=] <expr>`.
 * If so, returns the text of the left-hand side as a stable identity for the
 * "subject" being bucketed.
 *
 * The point is to identify range-bucketing chains like
 *   `x > 10 ? 'big' : x > 5 ? 'medium' : 'small'`
 * where every condition is a relational comparison on the same subject (`x`).
 * Such chains are genuine nested-ternary code smells.
 *
 * Conditions whose root is NOT a relational comparison (e.g. `cond &&`,
 * `cond ||`, equality, identifier, type-check, call, etc.) return null —
 * the chain is then NOT considered a range-bucketing pattern.
 */
function relationalSubject(cond: SyntaxNode | null): string | null {
  const cur = stripParens(cond)
  if (!cur || cur.type !== 'binary_expression') return null
  const op = cur.childForFieldName('operator')?.text
  if (op !== '<' && op !== '>' && op !== '<=' && op !== '>=') return null
  const left = cur.childForFieldName('left')
  if (!left) return null
  return left.text
}

export const nestedTernaryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-ternary',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['ternary_expression'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')

    const hasTernaryChild = unwrapTernary(consequence) !== null ||
      unwrapTernary(alternative) !== null

    if (!hasTernaryChild) return null

    // Only flag chains that are genuine range-bucketing: every condition in
    // the chain must be a relational comparison (<, >, <=, >=) on the same
    // subject. The canonical TP `x > 10 ? 'big' : x > 5 ? 'medium' : 'small'`
    // matches.
    //
    // Anything else — switch-like equality lookups, type-check dispatch,
    // truthy/fallback chains, JSX conditional rendering, mixed
    // equality/comparison — is a readable idiomatic pattern and a known FP.
    const chain = collectChain(node)
    let bucketingSubject: string | null = null
    let isBucketing = true
    for (const t of chain) {
      const subj = relationalSubject(t.childForFieldName('condition'))
      if (subj === null) {
        isBucketing = false
        break
      }
      if (bucketingSubject === null) {
        bucketingSubject = subj
      } else if (bucketingSubject !== subj) {
        isBucketing = false
        break
      }
    }
    if (!isBucketing) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Nested ternary expression',
      'Ternary inside a ternary is hard to read. Use if/else or extract the logic into a helper function.',
      sourceCode,
      'Replace nested ternary with if/else or a helper function.',
    )
  },
}
