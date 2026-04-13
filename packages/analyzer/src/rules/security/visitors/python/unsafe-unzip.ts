import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonImportSources } from '../../../_shared/python-framework-detection.js'

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
      // Check if the file imports an archive module (zipfile, tarfile, gzip, etc.)
      const sources = getPythonImportSources(node)
      let isArchiveContext = false
      for (const src of sources) {
        if (src === 'zipfile' || src === 'tarfile' || src === 'gzip' || src === 'bz2' ||
            src === 'lzma' || src === 'shutil' || src.startsWith('zipfile.') ||
            src.startsWith('tarfile.')) {
          isArchiveContext = true
          break
        }
      }

      // Also check the receiver object name for known archive class names
      if (!isArchiveContext) {
        const obj = fn.childForFieldName('object')
        if (obj) {
          const objName = obj.type === 'identifier' ? obj.text : ''
          const ARCHIVE_RECEIVER_NAMES = ['zip', 'zipfile', 'tar', 'tarfile', 'archive', 'zf', 'tf']
          if (ARCHIVE_RECEIVER_NAMES.some(n => objName.toLowerCase() === n || objName.toLowerCase().endsWith('_' + n))) {
            isArchiveContext = true
          }
        }
      }

      if (isArchiveContext) {
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
