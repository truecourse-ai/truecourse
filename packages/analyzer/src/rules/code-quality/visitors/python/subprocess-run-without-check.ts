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
      // Bare `run(...)` could be `subprocess.run` (after `from
      // subprocess import run`) OR an unrelated local helper. Skip
      // when the file does NOT import `run` from subprocess. Common
      // FP: `result = run()` calling a local `run` lambda/function.
      const root = (() => {
        let cur: typeof node | null = node
        while (cur && cur.parent) cur = cur.parent
        return cur
      })()
      if (root) {
        const text = root.text
        // Look for `from subprocess import ... run ...` or `import subprocess`.
        const importsRun =
          /\bfrom\s+subprocess\s+import\b[^\n]*\brun\b/.test(text) ||
          /\bimport\s+subprocess\b/.test(text)
        if (importsRun) isSubprocessRun = true
      }
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
