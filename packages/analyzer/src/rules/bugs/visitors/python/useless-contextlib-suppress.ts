import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUselessContextlibSuppressVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-contextlib-suppress',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const isSuppress = (fn.type === 'attribute' &&
        fn.childForFieldName('object')?.text === 'contextlib' &&
        fn.childForFieldName('attribute')?.text === 'suppress') ||
      (fn.type === 'identifier' && fn.text === 'suppress')

    if (!isSuppress) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // No arguments — suppress() with no exceptions does nothing
    if (args.namedChildren.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless contextlib.suppress',
        '`contextlib.suppress()` called with no exception types suppresses nothing — this is a no-op.',
        sourceCode,
        'Pass at least one exception type to suppress, e.g. `contextlib.suppress(FileNotFoundError)`.',
      )
    }
    return null
  },
}
