import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsIamPublicAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-iam-public-access',
  languages: ['typescript', 'javascript'],
  nodeTypes: ['new_expression', 'call_expression'],
  visit(node, filePath, sourceCode) {
    const fnOrCtor = node.childForFieldName('constructor') ?? node.childForFieldName('function')
    if (!fnOrCtor) return null

    let name = ''
    if (fnOrCtor.type === 'identifier') {
      name = fnOrCtor.text
    } else if (fnOrCtor.type === 'member_expression') {
      const prop = fnOrCtor.childForFieldName('property')
      if (prop) name = prop.text
    }

    // new PolicyStatement({ principal: { AWS: '*' } }) — JSON-style principal
    if (name === 'PolicyStatement') {
      const nodeText = node.text
      // Detect inline JSON-style principal with wildcard: principal: { AWS: '*' }
      if (/principal\s*:\s*\{\s*['"]?AWS['"]?\s*:\s*['"][*]['"]/.test(nodeText)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'IAM public access',
          `new ${name}() grants access to all principals (*). This allows any AWS user to invoke this policy.`,
          sourceCode,
          'Restrict Principal to specific IAM roles, users, or accounts instead of using wildcard.',
        )
      }
    }

    // new AnyPrincipal() — standalone usage
    if (name === 'AnyPrincipal' && node.type === 'new_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'IAM public access',
        'new AnyPrincipal() grants access to every AWS user and account.',
        sourceCode,
        'Use a specific principal (AccountPrincipal, ArnPrincipal, etc.) instead of AnyPrincipal.',
      )
    }

    return null
  },
}
