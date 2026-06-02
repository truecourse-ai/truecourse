import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isGeneratedFile } from '../../../_shared/javascript-helpers.js'

// Count direct statements in a body. For a single-statement body (no braces),
// the body node IS the statement. For a `statement_block`, count the
// statement children. Other shapes (expressions, comments) count as one.
function statementCount(body: SyntaxNode | null | undefined): number {
  if (!body) return 0
  if (body.type === 'statement_block') {
    return body.namedChildren.filter((c) => c.type !== 'comment').length
  }
  return 1
}

export const negatedConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/negated-condition',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Codegen output (parser/lexer scaffolding) writes `if (!cond)` branches
    // that mirror the grammar's structure; the generator picks the polarity,
    // not the author, so inverting them isn't a meaningful suggestion.
    if (isGeneratedFile(filePath, sourceCode)) return null

    const condition = node.childForFieldName('condition')
    const elsePart = node.children.find((c) => c.type === 'else_clause')
    if (!condition || !elsePart) return null

    const inner = condition.type === 'parenthesized_expression' ? condition.namedChildren[0] : condition
    if (!inner || inner.type !== 'unary_expression') return null
    const op = inner.childForFieldName('operator') ?? inner.children[0]
    if (!op || op.text !== '!') return null

    const elseBody = elsePart.namedChildren[0]
    if (elseBody?.type === 'if_statement') return null

    // The rule's value is when inversion moves a short bail/guard branch out
    // of the way of a substantial happy path: `if (!ready) return; else {…}`
    // reads better as `if (ready) {…} else return;`. When both branches are
    // substantive (and especially when the if-branch is bigger), the
    // negation is a deliberate choice — naming the *negative* case the
    // primary one — and inverting is no longer obviously better. Skip
    // unless the else-body is meaningfully larger than the if-body.
    const ifBody = node.childForFieldName('consequence')
    const ifCount = statementCount(ifBody)
    const elseCount = statementCount(elseBody)
    if (elseCount < ifCount + 2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Negated condition with else',
      'Condition is negated but has an else block. Invert the condition and swap the branches for better readability.',
      sourceCode,
      'Invert the condition and swap the if/else bodies.',
    )
  },
}
