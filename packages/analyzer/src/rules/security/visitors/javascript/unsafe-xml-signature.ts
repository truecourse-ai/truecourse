import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unsafeXmlSignatureVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-xml-signature',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const ctor = node.childForFieldName('constructor')
    if (!ctor) return null

    let ctorName = ''
    if (ctor.type === 'identifier') {
      ctorName = ctor.text
    } else if (ctor.type === 'member_expression') {
      const prop = ctor.childForFieldName('property')
      if (prop) ctorName = prop.text
    }

    if (ctorName !== 'SignedXml') return null

    const args = node.childForFieldName('arguments')
    // If no args or no options object with secure config, flag it
    if (!args || args.namedChildren.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe XML signature verification',
        'new SignedXml() without explicit security configuration may allow signature wrapping attacks.',
        sourceCode,
        'Configure allowedTransforms and warnOnDuplicateAttributes in the SignedXml options.',
      )
    }

    return null
  },
}
