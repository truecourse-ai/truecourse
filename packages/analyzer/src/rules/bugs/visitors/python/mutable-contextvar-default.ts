import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonMutableContextvarDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/mutable-contextvar-default',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const isCVar =
      (fn.type === 'identifier' && fn.text === 'ContextVar') ||
      (fn.type === 'attribute' && fn.childForFieldName('attribute')?.text === 'ContextVar')
    if (!isCVar) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const kw = arg.childForFieldName('name')
        const val = arg.childForFieldName('value')
        if (kw?.text === 'default' && val) {
          if (val.type === 'list' || val.type === 'dictionary' || val.type === 'set') {
            return makeViolation(
              this.ruleKey, arg, filePath, 'high',
              'Mutable ContextVar default',
              `\`ContextVar\` has a mutable \`${val.type}\` as default — this instance is shared across all async contexts.`,
              sourceCode,
              'Use an immutable default value or set the default to `None` and initialize per-context.',
            )
          }
        }
      }
    }
    return null
  },
}
