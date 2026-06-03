import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const fallthroughCaseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fallthrough-case',
  languages: JS_LANGUAGES,
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const cases = body.namedChildren.filter((c) => c.type === 'switch_case')

    for (let i = 0; i < cases.length - 1; i++) {
      const caseNode = cases[i]
      const valueNode = caseNode.childForFieldName('value')
      const statements = caseNode.namedChildren.filter(
        (c) => c.type !== 'comment' && (!valueNode || c.id !== valueNode.id),
      )

      // Empty case body (intentional grouping) — skip
      if (statements.length === 0) continue

      const last = statements[statements.length - 1]
      if (last && isTerminating(last)) continue

      return makeViolation(
        this.ruleKey, caseNode, filePath, 'medium',
        'Switch case fallthrough',
        'This case does not end with break, return, or throw — it falls through to the next case.',
        sourceCode,
        'Add a break, return, or throw statement, or add a // falls through comment if intentional.',
      )
    }
    return null
  },
}

// A statement terminates control flow if every path through it ends in a
// break / return / throw / continue. Recurses into blocks, try/catch/finally,
// and if/else so wrapped patterns are recognized.
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
    const stmts = node.namedChildren.filter((c) => c.type !== 'comment')
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
    return sawCatch || true
  }

  if (node.type === 'if_statement') {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    if (!consequence || !alternative) return false
    if (!isTerminating(consequence)) return false
    const altInner = alternative.type === 'else_clause' ? alternative.namedChildren[0] : alternative
    if (!altInner) return false
    return isTerminating(altInner)
  }

  return false
}
