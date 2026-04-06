import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_UNSAFE_XML_PARSERS = new Set(['parse', 'fromstring', 'iterparse', 'XMLParser'])

export const pythonXmlXxeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/xml-xxe',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    }

    // xml.etree.ElementTree.parse(), ET.parse(), etree.parse()
    if (PYTHON_UNSAFE_XML_PARSERS.has(methodName) &&
        (objectName.includes('ElementTree') || objectName === 'ET' || objectName === 'etree' ||
         objectName === 'xml' || objectName === 'lxml')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'XML external entity injection',
        `${objectName}.${methodName}() may be vulnerable to XXE attacks.`,
        sourceCode,
        'Use defusedxml instead: from defusedxml.ElementTree import parse.',
      )
    }

    return null
  },
}
