import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { DUNDER_PARAM_COUNTS } from './_helpers.js'

export const pythonUnexpectedSpecialMethodSignatureVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unexpected-special-method-signature',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name) return null

    const methodName = name.text
    const expected = DUNDER_PARAM_COUNTS[methodName]
    if (!expected) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Count non-special params (exclude *args, **kwargs, /)
    const paramCount = params.namedChildren.filter((c) =>
      c.type === 'identifier' || c.type === 'typed_parameter' || c.type === 'default_parameter' ||
      c.type === 'typed_default_parameter'
    ).length

    if (paramCount < expected.min || paramCount > expected.max) {
      const expectedDesc = expected.min === expected.max
        ? `${expected.min}`
        : expected.max === Infinity ? `at least ${expected.min}` : `${expected.min}–${expected.max}`
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Wrong special method signature',
        `\`${methodName}\` should have ${expectedDesc} parameter(s) but has ${paramCount}.`,
        sourceCode,
        `Fix the number of parameters for \`${methodName}\` to match the expected signature.`,
      )
    }

    return null
  },
}
