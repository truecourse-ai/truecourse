import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const XML_PARSE_FUNCTIONS = new Set(['parseString', 'parseStringPromise', 'parseXml'])

export const xmlXxeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/xml-xxe',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression', 'call_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'new_expression') {
      const constructor = node.childForFieldName('constructor')
      if (!constructor) return null

      if (constructor.text === 'DOMParser') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'XML external entity injection',
          'DOMParser may be vulnerable to XXE attacks. Ensure external entities are disabled.',
          sourceCode,
          'Use a secure XML parser or disable external entity resolution.',
        )
      }
    }

    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function')
      if (!fn) return null

      let funcName = ''
      if (fn.type === 'member_expression') {
        const prop = fn.childForFieldName('property')
        if (prop) funcName = prop.text
      } else if (fn.type === 'identifier') {
        funcName = fn.text
      }

      if (XML_PARSE_FUNCTIONS.has(funcName)) {
        // Check if options argument disables entities
        const args = node.childForFieldName('arguments')
        if (args) {
          // If there's no second argument (options), flag it
          if (args.namedChildren.length < 2) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'XML external entity injection',
              `${funcName}() called without explicitly disabling external entities.`,
              sourceCode,
              'Pass options to disable external entity resolution (e.g., { xmldec: { noent: false } }).',
            )
          }
        }
      }
    }

    return null
  },
}
