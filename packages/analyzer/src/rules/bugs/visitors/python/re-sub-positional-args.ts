import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonReSubPositionalArgsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/re-sub-positional-args',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Match re.sub or re.subn
    const isReSub = (fn.type === 'attribute' &&
        fn.childForFieldName('object')?.text === 're' &&
        (fn.childForFieldName('attribute')?.text === 'sub' || fn.childForFieldName('attribute')?.text === 'subn'))

    if (!isReSub) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    // Count positional args (non-keyword)
    const positionalArgs = argNodes.filter((a) => a.type !== 'keyword_argument')

    // If 4 or more positional args, the 4th is count (not flags)
    // Detect: 4th positional arg looks like a flag (re.IGNORECASE, re.MULTILINE, etc.)
    if (positionalArgs.length >= 4) {
      const fourthArg = positionalArgs[3]
      const fourthText = fourthArg.text
      const RE_FLAGS = new Set(['re.IGNORECASE', 're.MULTILINE', 're.DOTALL', 're.VERBOSE', 're.ASCII', 're.UNICODE', 're.LOCALE', 'IGNORECASE', 'MULTILINE', 'DOTALL', 'VERBOSE', 'ASCII', 'UNICODE'])
      if (RE_FLAGS.has(fourthText) ||
          (fourthArg.type === 'attribute' && fourthArg.childForFieldName('object')?.text === 're')) {
        return makeViolation(
          this.ruleKey, fourthArg, filePath, 'medium',
          're.sub positional arguments confusion',
          `\`re.sub\` signature is \`re.sub(pattern, repl, string, count=0, flags=0)\` — the 4th positional argument is \`count\`, not \`flags\`. Passing \`${fourthText}\` as the 4th positional argument sets \`count\` to an unexpected value.`,
          sourceCode,
          `Use keyword arguments: \`re.sub(pattern, repl, string, flags=${fourthText})\`.`,
        )
      }
    }
    return null
  },
}
