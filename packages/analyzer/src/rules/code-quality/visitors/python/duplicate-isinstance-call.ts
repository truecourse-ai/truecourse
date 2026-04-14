import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function getIsinstanceArgs(node: SyntaxNode): { obj: string; type: string } | null {
  const fn = node.childForFieldName('function')
  if (!fn || fn.type !== 'identifier' || fn.text !== 'isinstance') return null
  const args = node.childForFieldName('arguments')
  if (!args) return null
  const positional = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
  if (positional.length < 2) return null
  return { obj: positional[0].text, type: positional[1].text }
}

export const pythonDuplicateIsinstanceCallVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-isinstance-call',
  languages: ['python'],
  nodeTypes: ['boolean_operator'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName?.('operator')?.text !== 'or') {
      const opChild = node.children.find((c) => c.type === 'or')
      if (!opChild) return null
    }

    // Collect all isinstance calls in this boolean expression
    const calls: Array<{ obj: string; type: string; node: SyntaxNode }> = []

    function collectIsinstance(n: SyntaxNode): void {
      if (n.type === 'call') {
        const result = getIsinstanceArgs(n)
        if (result) calls.push({ ...result, node: n })
        return
      }
      if (n.type === 'boolean_operator') {
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child) collectIsinstance(child)
        }
      }
    }

    collectIsinstance(node)
    if (calls.length < 2) return null

    // Check if any two calls have the same object
    const byObj = new Map<string, typeof calls>()
    for (const call of calls) {
      const existing = byObj.get(call.obj) ?? []
      existing.push(call)
      byObj.set(call.obj, existing)
    }

    for (const [obj, objCalls] of byObj) {
      if (objCalls.length >= 2) {
        const types = objCalls.map((c) => c.type).join(', ')
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Duplicate isinstance calls',
          `Multiple \`isinstance(${obj}, ...)\` calls can be merged: \`isinstance(${obj}, (${types}))\`.`,
          sourceCode,
          `Merge the isinstance calls: \`isinstance(${obj}, (${types}))\`.`,
        )
      }
    }
    return null
  },
}
