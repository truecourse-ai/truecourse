import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_EXTRACT_METHODS = new Set(['extractall', 'extract'])

export const pythonUnsafeUnzipVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-unzip',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (PYTHON_EXTRACT_METHODS.has(methodName)) {
      // Check context — is this likely a ZipFile/TarFile method?
      const fullText = fn.text
      if (fullText.includes('zip') || fullText.includes('Zip') ||
          fullText.includes('tar') || fullText.includes('Tar') ||
          fullText.includes('archive') || fullText.includes('Archive')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe archive extraction',
          `${methodName}() extracts archive contents without size/count limits. Risk of zip bomb attack.`,
          sourceCode,
          'Validate archive entry sizes and count before extraction. Use extractall() with caution.',
        )
      }
    }

    return null
  },
}
