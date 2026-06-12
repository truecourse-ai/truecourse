import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, getCreatedTypeName, lastSegment } from './_helpers.js'

/**
 * XML parsing opened up to external entities: `DtdProcessing.Parse`,
 * legacy `ProhibitDtd = false`, or wiring an `XmlUrlResolver` into a
 * parser's `XmlResolver`. Secure settings (Prohibit/Ignore, resolver = null)
 * never match.
 */
export const csharpXmlXxeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/xml-xxe',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const target = assignmentTarget(node)
    if (!target) return null

    if (target.name === 'DtdProcessing' && lastSegment(target.value.text) === 'Parse' && /DtdProcessing/.test(target.value.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'XML external entity injection',
        'DtdProcessing.Parse enables DTD processing, exposing the parser to XXE and entity-expansion attacks.',
        sourceCode,
        'Use DtdProcessing.Prohibit (default) or Ignore unless DTDs from a trusted source are required.',
      )
    }

    if (target.name === 'ProhibitDtd' && target.value.text === 'false') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'XML external entity injection',
        'ProhibitDtd = false enables DTD processing, exposing the parser to XXE attacks.',
        sourceCode,
        'Leave ProhibitDtd = true, or migrate to DtdProcessing.Prohibit.',
      )
    }

    if (target.name === 'XmlResolver' && target.value.type === 'object_creation_expression' && getCreatedTypeName(target.value) === 'XmlUrlResolver') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'XML external entity injection',
        'Assigning an XmlUrlResolver lets the XML parser fetch external entities from arbitrary URLs.',
        sourceCode,
        'Set XmlResolver = null, or use XmlSecureResolver with a restricted URL set.',
      )
    }

    return null
  },
}
