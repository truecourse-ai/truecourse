import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const unreachableLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreachable-loop',
  languages: JS_LANGUAGES,
  nodeTypes: ['for_statement', 'for_in_statement', 'while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    let body: SyntaxNode | null = null
    if (node.type === 'for_statement' || node.type === 'while_statement' || node.type === 'do_statement') {
      body = node.childForFieldName('body')
    } else if (node.type === 'for_in_statement') {
      body = node.childForFieldName('body')
    }
    if (!body) return null

    // Get the actual statement block
    const block = body.type === 'statement_block' ? body : null
    if (!block) return null

    const statements = block.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) return null

    const last = statements[statements.length - 1]
    const EXITS = new Set(['return_statement', 'throw_statement', 'break_statement'])

    if (EXITS.has(last.type)) {
      // Check there's no continue or conditional before the exit
      const hasContinue = statements.some((s) => s.type === 'continue_statement')
      if (hasContinue) return null

      // If the exit is inside an if, it's conditional — skip
      // We only flag when the unconditional last statement is an exit
      if (last.parent?.type !== 'statement_block') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unreachable loop',
        `Loop body always exits on the first iteration via \`${last.type.replace('_statement', '')}\`.`,
        sourceCode,
        'If intentional, use an if statement instead. Otherwise, move the exit into a condition.',
      )
    }
    return null
  },
}
