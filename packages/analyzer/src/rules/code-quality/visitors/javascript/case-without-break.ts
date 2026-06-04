import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const caseWithoutBreakVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/case-without-break',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_case'],
  visit(node, filePath, sourceCode) {
    const valueNode = node.childForFieldName('value')
    const stmts = node.namedChildren.filter((c) => !valueNode || c.id !== valueNode.id)

    if (stmts.length === 0) return null

    const last = stmts[stmts.length - 1]
    if (isTerminating(last)) return null

    const nodeText = node.text
    if (/fallthrough|falls?\s*through|fall-through/i.test(nodeText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Switch case without break',
      'Switch case falls through to the next case — add a `break`, `return`, or `throw`, or mark intentional fallthrough with a comment.',
      sourceCode,
      'Add `break;` at the end of the case, or add a `// fallthrough` comment if intentional.',
    )
  },
}

// A statement terminates control flow if every path through it ends in a
// break / return / throw / continue. Recurses into blocks, try/catch/finally,
// and if/else so wrapped patterns (`case X: { try { return … } catch { return
// … } }`) are recognized.
function isTerminating(node: SyntaxNode): boolean {
  if (
    node.type === 'break_statement' ||
    node.type === 'return_statement' ||
    node.type === 'throw_statement' ||
    node.type === 'continue_statement'
  ) {
    return true
  }

  if (node.type === 'statement_block') {
    const stmts = node.namedChildren
    if (stmts.length === 0) return false
    return isTerminating(stmts[stmts.length - 1])
  }

  if (node.type === 'try_statement') {
    const body = node.childForFieldName('body')
    if (!body || !isTerminating(body)) return false
    let sawCatch = false
    for (const child of node.namedChildren) {
      if (child.type === 'catch_clause') {
        sawCatch = true
        const cbody = child.childForFieldName('body')
        if (!cbody || !isTerminating(cbody)) return false
      } else if (child.type === 'finally_clause') {
        const fbody = child.childForFieldName('body')
        if (fbody && isTerminating(fbody)) return true
      }
    }
    // If there's no catch, an uncaught throw could escape — but it still
    // exits the case via throwing, so the case doesn't fall through.
    return sawCatch || true
  }

  if (node.type === 'if_statement') {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    if (!consequence || !alternative) return false
    if (!isTerminating(consequence)) return false
    // alternative is an 'else_clause' wrapping the next statement, or directly the statement
    const altInner = alternative.type === 'else_clause' ? alternative.namedChildren[0] : alternative
    if (!altInner) return false
    return isTerminating(altInner)
  }

  return false
}
