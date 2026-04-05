import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: __exit__ method without the correct 4-parameter signature
// __exit__ must accept (self, exc_type, exc_val, exc_tb)
// __aexit__ must accept (self, exc_type, exc_val, exc_tb)
export const pythonExitMethodWrongSignatureVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exit-method-wrong-signature',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const methodName = nameNode.text
    if (methodName !== '__exit__' && methodName !== '__aexit__') return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Count required positional parameters (exclude *args, **kwargs, and those with defaults)
    const paramChildren = params.namedChildren
    let positionalCount = 0
    let hasVarArgs = false

    for (const param of paramChildren) {
      if (param.type === 'list_splat_pattern' || param.text.startsWith('*')) {
        hasVarArgs = true
        break
      }
      if (param.type === 'identifier' || param.type === 'typed_parameter') {
        // Check if it has a default (defaulted_parameter)
        positionalCount++
      }
      if (param.type === 'defaulted_parameter') {
        // Has default, still counts but not as required
        break
      }
    }

    // If has *args or **kwargs, we can't be sure of the issue
    if (hasVarArgs) return null

    // Require exactly 4 parameters: self, exc_type, exc_val, exc_tb
    if (positionalCount !== 4) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        `${methodName} wrong parameter count`,
        `\`${methodName}\` must accept exactly 4 parameters: \`(self, exc_type, exc_val, exc_tb)\` — got ${positionalCount}. Incorrect signature breaks exception handling.`,
        sourceCode,
        `Define \`${methodName}(self, exc_type, exc_val, exc_tb)\` with all 4 parameters.`,
      )
    }

    return null
  },
}
