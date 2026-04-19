import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function getMethodNames(classBody: SyntaxNode): string[] {
  const names: string[] = []
  for (let i = 0; i < classBody.childCount; i++) {
    const child = classBody.child(i)
    if (!child) continue
    let funcNode: SyntaxNode | null = null
    if (child.type === 'function_definition') {
      funcNode = child
    } else if (child.type === 'decorated_definition') {
      funcNode = child.namedChildren.find((c) => c.type === 'function_definition') ?? null
    }
    if (funcNode) {
      const nameNode = funcNode.childForFieldName('name')
      if (nameNode) names.push(nameNode.text)
    }
  }
  return names
}

export const pythonEqWithoutHashVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/eq-without-hash',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    const methods = getMethodNames(bodyNode)
    const hasEq = methods.includes('__eq__')
    const hasHash = methods.includes('__hash__')

    if (!hasEq || hasHash) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'class'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      '__eq__ without __hash__',
      `Class \`${name}\` defines \`__eq__\` but not \`__hash__\` — instances cannot be used in sets or as dict keys.`,
      sourceCode,
      'Add `__hash__ = None` to explicitly mark as unhashable, or implement `__hash__` consistent with `__eq__`.',
    )
  },
}
