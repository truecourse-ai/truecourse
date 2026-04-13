import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isScriptLikeFile } from '../../../_shared/python-helpers.js'

export const pythonProcessExitInLibraryVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/process-exit-in-library',
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
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!((objectName === 'sys' && methodName === 'exit') || methodName === 'exit')) return null

    // Allow in entry-point / script-like files
    if (isScriptLikeFile(node, filePath)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'sys.exit() in non-entry-point code',
      `${objectName ? objectName + '.' : ''}${methodName}() terminates the process. Library code should raise exceptions instead.`,
      sourceCode,
      'Raise an exception instead of calling sys.exit(), and let the caller decide how to handle it.',
    )
  },
}
