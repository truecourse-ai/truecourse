import type { CodeRuleVisitor } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'
import { makeViolation } from '../../../types.js'
import { findUserInputAccess } from '../../../_shared/javascript-helpers.js'

export const pathCommandInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/path-command-injection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) methodName = prop.text
      if (obj) objectName = obj.text
    }

    if (objectName !== 'path' || methodName !== 'join') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Real AST + scope-aware user input detection. See _shared/javascript-helpers.ts.
    for (const arg of args.namedChildren) {
      if (findUserInputAccess(arg, dataFlow)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Path-based command injection',
          'path.join() with user-controlled input may allow path traversal attacks.',
          sourceCode,
          'Validate and sanitize user input before using it in file paths. Use path.resolve() and verify the result is within the expected directory.',
        )
      }
    }

    return null
  },
}
