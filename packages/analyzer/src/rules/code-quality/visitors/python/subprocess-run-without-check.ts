import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSubprocessRunWithoutCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/subprocess-run-without-check',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isSubprocessRun = false
    if (fn.type === 'identifier' && fn.text === 'run') {
      // Could be subprocess.run or just run()
      isSubprocessRun = true
    } else if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if ((obj?.text === 'subprocess' || obj?.text === 'sp') && attr?.text === 'run') {
        isSubprocessRun = true
      }
    }

    if (!isSubprocessRun) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const hasCheck = args.namedChildren.some((a) => {
      if (a.type === 'keyword_argument') {
        const key = a.childForFieldName('name')
        return key?.text === 'check'
      }
      return false
    })

    if (hasCheck) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'subprocess.run without check',
      '`subprocess.run()` called without `check=True` — non-zero exit codes are silently ignored.',
      sourceCode,
      'Add `check=True` to raise `CalledProcessError` on non-zero exit codes, or explicitly handle the return code.',
    )
  },
}
