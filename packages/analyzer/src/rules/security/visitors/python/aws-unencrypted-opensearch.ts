import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

export const pythonAwsUnencryptedOpenSearchVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-opensearch-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text
    }

    if (funcName !== 'Domain' && funcName !== 'CfnDomain') return null

    // Walk keyword arguments for encryption configuration
    const argsNode = node.childForFieldName('arguments')
    if (!argsNode) return null

    for (const arg of argsNode.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (!name || !value) continue

        const keyName = name.text
        if (keyName === 'encryption_at_rest' || keyName === 'encrypt_at_rest' ||
            keyName === 'EncryptionAtRestOptions' || keyName === 'encryption_at_rest_options') {
          // Check for enabled=False inside the value — False is a `false` node type, not identifier
          const hasFalse = value.type === 'false' || value.text === 'False' ||
            (value.type === 'dictionary' && value.namedChildren.some(p =>
              p.type === 'pair' && p.childForFieldName('value')?.type === 'false'))
          if (hasFalse) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Unencrypted OpenSearch domain',
              `${funcName}() configured with encryption at rest disabled.`,
              sourceCode,
              'Enable encryption at rest for the OpenSearch domain.',
            )
          }
        }
      }
    }

    return null
  },
}
