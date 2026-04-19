import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const parameterReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/parameter-reassignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    const paramNames = new Set<string>()
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i)
      if (p) {
        if (p.type === 'identifier') paramNames.add(p.text)
        else if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
          const nameNode = p.childForFieldName('pattern') ?? p.namedChildren[0]
          if (nameNode?.type === 'identifier') paramNames.add(nameNode.text)
        } else if (p.type === 'assignment_pattern') {
          const left = p.childForFieldName('left')
          if (left?.type === 'identifier') paramNames.add(left.text)
        } else if (p.type === 'rest_pattern') {
          const inner = p.namedChildren[0]
          if (inner?.type === 'identifier') paramNames.add(inner.text)
        }
      }
    }

    if (paramNames.size === 0) return null

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return null

      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && paramNames.has(left.text)) {
          return left
        }
      }
      if (n.type === 'update_expression') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child?.type === 'identifier' && paramNames.has(child.text)) return child
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
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
        `Parameter \`${reassigned.text}\` is reassigned. Use a local variable instead to keep function parameters immutable.`,
        sourceCode,
        `Introduce a local variable: \`let local = ${reassigned.text};\` and modify that instead.`,
      )
    }
    return null
  },
}
