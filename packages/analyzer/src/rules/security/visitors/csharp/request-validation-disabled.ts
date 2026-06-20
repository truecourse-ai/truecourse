import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributes } from './_helpers.js'

/**
 * `[ValidateInput(false)]` on an ASP.NET controller or action. The attribute
 * turns off the framework's built-in request-validation guard, which rejects
 * markup-like input as a first line of XSS defense.
 */
export const csharpRequestValidationDisabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/request-validation-disabled',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'class_declaration'],
  visit(node, filePath, sourceCode) {
    const attr = getCSharpAttributes(node).find((a) => a.name === 'ValidateInput')
    if (!attr) return null
    const arg = attr.args[0]?.value
    if (arg?.type !== 'boolean_literal' || arg.text !== 'false') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'ASP.NET request validation disabled',
      'ValidateInput(false) turns off the framework’s request-validation guard, removing a built-in defense that rejects markup-like input.',
      sourceCode,
      'Leave request validation enabled and explicitly encode or sanitize the specific fields that legitimately accept markup.',
    )
  },
}
