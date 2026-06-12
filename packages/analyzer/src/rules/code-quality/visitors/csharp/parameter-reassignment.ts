import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, isCSharpFunctionBoundary } from './_helpers.js'

export const csharpParameterReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/parameter-reassignment',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    const paramNames = new Set<string>()
    for (const param of params.namedChildren) {
      if (!param || param.type !== 'parameter') continue
      // `ref` / `out` parameters exist to be assigned.
      if (param.children.some((c) => c?.type === 'modifier' && (c.text === 'ref' || c.text === 'out'))) continue
      const nameNode = param.childForFieldName('name')
      if (nameNode?.type === 'identifier') paramNames.add(nameNode.text)
    }
    if (paramNames.size === 0) return null

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      // Lambdas / local functions have their own parameter scopes, but a
      // capture that mutates an outer parameter still counts — only skip
      // nested functions that redeclare the same name.
      if (isCSharpFunctionBoundary(n.type) && n.id !== node.id) return null

      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && paramNames.has(left.text)) return left
      }
      if (n.type === 'postfix_unary_expression' || n.type === 'prefix_unary_expression') {
        const op = n.children.find((c) => c?.type === '++' || c?.type === '--')
        if (op) {
          const target = n.namedChildren[0]
          if (target?.type === 'identifier' && paramNames.has(target.text)) return target
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          const result = findReassignment(child)
          if (result) return result
        }
      }
      return null
    }

    const reassigned = findReassignment(bodyNode)
    if (reassigned) {
      return makeViolation(
        this.ruleKey, reassigned, filePath, 'medium',
        'Parameter reassignment',
        `Parameter \`${reassigned.text}\` is reassigned. Use a local variable instead to keep method parameters immutable.`,
        sourceCode,
        `Introduce a local variable: \`var local = ${reassigned.text};\` and modify that instead.`,
      )
    }
    return null
  },
}
