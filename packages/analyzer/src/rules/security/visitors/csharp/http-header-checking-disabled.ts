import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, getInitializerAssignments } from './_helpers.js'

/**
 * `EnableHeaderChecking = false` — either as an assignment
 * (`httpRuntime.EnableHeaderChecking = false`) or inside an object initializer.
 * Header checking applies the CR/LF encoding that prevents HTTP response-header
 * (response-splitting) injection; disabling it removes that guard.
 */
export const csharpHttpHeaderCheckingDisabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/http-header-checking-disabled',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'assignment_expression') {
      const target = assignmentTarget(node)
      if (!target || target.name !== 'EnableHeaderChecking') return null
      if (target.value.type !== 'boolean_literal' || target.value.text !== 'false') return null
    } else {
      const hit = getInitializerAssignments(node).find(
        (a) => a.name === 'EnableHeaderChecking' && a.value.type === 'boolean_literal' && a.value.text === 'false',
      )
      if (!hit) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'HTTP header checking disabled',
      'Setting EnableHeaderChecking to false removes the CR/LF encoding that prevents HTTP response-header (response-splitting) injection.',
      sourceCode,
      'Leave header checking enabled (the default) so response headers are encoded against injection.',
    )
  },
}
