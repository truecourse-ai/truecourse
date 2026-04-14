import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function getAppendTarget(node: SyntaxNode): string | null {
  if (node.type !== 'expression_statement') return null
  const call = node.namedChildren[0]
  if (!call || call.type !== 'call') return null
  const fn = call.childForFieldName('function')
  if (!fn || fn.type !== 'attribute') return null
  const attr = fn.childForFieldName('attribute')
  if (!attr || attr.text !== 'append') return null
  const obj = fn.childForFieldName('object')
  return obj?.text ?? null
}

export const pythonRepeatedAppendVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/repeated-append',
  languages: ['python'],
  nodeTypes: ['block', 'module'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    for (let i = 0; i < children.length - 2; i++) {
      const t1 = getAppendTarget(children[i])
      const t2 = getAppendTarget(children[i + 1])
      const t3 = getAppendTarget(children[i + 2])

      if (t1 && t1 === t2 && t1 === t3) {
        return makeViolation(
          this.ruleKey, children[i], filePath, 'low',
          'Repeated append calls',
          `3+ consecutive \`${t1}.append(...)\` calls — use \`${t1}.extend([...])\` instead.`,
          sourceCode,
          `Replace sequential \`${t1}.append()\` calls with a single \`${t1}.extend([...])\`.`,
        )
      }
    }
    return null
  },
}
