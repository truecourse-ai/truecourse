import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noExplicitAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-explicit-any',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_annotation'],
  visit(node, filePath, sourceCode) {
    const typeNode = node.namedChildren[0]
    if (!typeNode) return null
    if (typeNode.type === 'predefined_type' && typeNode.text === 'any') {
      // Skip the `any` return type of a visitor-pattern dispatch method
      // (`visit`, `visitChildren`, `visit<Node>`, ...). The visitor interface
      // contract fixes the return type, so it's interface-imposed, not a
      // typing oversight. A method's return-type annotation sits directly
      // under the method node (param annotations are nested in parameters),
      // so this never suppresses `any` parameters.
      const owner = node.parent
      if (owner?.type === 'method_definition') {
        const methodName = owner.childForFieldName('name')?.text
        if (methodName && /^visit(?:[A-Z_].*)?$/.test(methodName)) return null
      }
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Explicit `any` type',
        'Using `: any` bypasses TypeScript type checking. Use a specific type or `unknown` instead.',
        sourceCode,
        'Replace `: any` with a specific type or `unknown`.',
      )
    }
    return null
  },
}
