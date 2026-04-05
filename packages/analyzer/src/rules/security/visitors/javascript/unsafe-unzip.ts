import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const UNZIP_SPECIFIC_METHODS = new Set(['extractAllTo', 'extractAllToAsync', 'extractEntryTo'])

export const unsafeUnzipVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-unzip',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) methodName = prop.text
      if (obj) objectName = obj.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    // extractAllTo, extractAllToAsync, extractEntryTo — always archive-specific
    if (UNZIP_SPECIFIC_METHODS.has(methodName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe archive extraction',
        `${methodName}() extracts archive contents without size/count limits. Risk of zip bomb attack.`,
        sourceCode,
        'Validate archive entry sizes and count before extraction. Set extraction limits.',
      )
    }

    // extract() — only flag when the object name suggests an archive context
    if (methodName === 'extract' && objectName) {
      const lower = objectName.toLowerCase()
      if (lower.includes('zip') || lower.includes('tar') || lower.includes('archive')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe archive extraction',
          `${methodName}() extracts archive contents without size/count limits. Risk of zip bomb attack.`,
          sourceCode,
          'Validate archive entry sizes and count before extraction. Set extraction limits.',
        )
      }
    }

    return null
  },
}
