import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSysExitAliasVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/sys-exit-alias',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    if (fn.text === 'exit' || fn.text === 'quit') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'sys.exit alias',
        `\`${fn.text}()\` is a REPL convenience alias that may not be available in all Python environments. Use \`sys.exit()\` instead.`,
        sourceCode,
        `Replace \`${fn.text}()\` with \`sys.exit()\` and ensure \`import sys\` is at the top of the file.`,
      )
    }

    return null
  },
}
