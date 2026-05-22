import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function statementTerminates(node: SyntaxNode): boolean {
  switch (node.type) {
    case 'return_statement':
    case 'throw_statement':
    case 'break_statement':
    case 'continue_statement':
      return true
    case 'statement_block': {
      // A block terminates iff its last statement terminates.
      const stmts = node.namedChildren
      if (stmts.length === 0) return false
      return statementTerminates(stmts[stmts.length - 1])
    }
    case 'if_statement': {
      const cons = node.childForFieldName('consequence')
      const alt = node.childForFieldName('alternative')
      if (!cons || !alt) return false
      // `if/else` terminates iff both branches terminate.
      return statementTerminates(cons) && statementTerminates(alt)
    }
    default:
      return false
  }
}

export const defaultCaseInSwitchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/default-case-in-switch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const hasDefault = body.namedChildren.some((c) => c.type === 'switch_default')
    if (hasDefault) return null

    const cases = body.namedChildren.filter((c) => c.type === 'switch_case')
    if (cases.length === 0) return null

    // Skip exhaustive switches — every case must end with a terminating
    // statement (return / throw / break / continue), or with a block / if-else
    // whose own terminating-suffix recursively satisfies the same shape.
    const allCasesTerminate = cases.every((caseNode) => {
      const caseChildren = caseNode.namedChildren
      if (caseChildren.length === 0) return false
      const lastChild = caseChildren[caseChildren.length - 1]
      return statementTerminates(lastChild)
    })
    if (allCasesTerminate) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Missing default case in switch',
      'Switch statement has no `default` case — may silently ignore unexpected values.',
      sourceCode,
      'Add a `default` case to handle unexpected values.',
    )
  },
}
