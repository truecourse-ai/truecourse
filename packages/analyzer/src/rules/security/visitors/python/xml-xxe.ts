import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonImportSources } from '../../../_shared/python-framework-detection.js'

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
    const UNSAFE_XML_RECEIVERS = new Set(['ElementTree', 'ET', 'etree', 'xml', 'lxml', 'XMLParser'])
    if (PYTHON_UNSAFE_XML_PARSERS.has(methodName) &&
        UNSAFE_XML_RECEIVERS.has(objectName)) {
      // Verify via import sources that this is an XML library
      const sources = getPythonImportSources(node)
      let isXmlImport = false
      for (const src of sources) {
        if (src === 'xml' || src.startsWith('xml.') || src === 'lxml' || src.startsWith('lxml.') ||
            src === 'xml.etree.ElementTree' || src === 'xml.dom' || src === 'xml.dom.minidom' ||
            src === 'xml.sax' || src === 'xml.parsers.expat') {
          isXmlImport = true
          break
        }
      }
      // Also accept the receiver name directly for common aliased imports (ET, etree)
      if (!isXmlImport && (objectName === 'ET' || objectName === 'etree' || objectName === 'ElementTree')) {
        isXmlImport = true // Common aliases; the import may use `as`
      }
      if (isXmlImport) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'XML external entity injection',
          `${objectName}.${methodName}() may be vulnerable to XXE attacks.`,
          sourceCode,
          'Use defusedxml instead: from defusedxml.ElementTree import parse.',
        )
      }
    }

    return null
  },
}
