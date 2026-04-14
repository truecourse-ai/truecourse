import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateFunctionArgumentsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-function-arguments',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const args = node.childForFieldName('arguments')
    if (!args) return null

    const seen = new Set<string>()
    for (const child of args.namedChildren) {
      if (child.type === 'keyword_argument') {
        const kw = child.childForFieldName('name')
        if (!kw) continue
        const kwName = kw.text
        if (seen.has(kwName)) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Duplicate keyword argument',
            `Keyword argument \`${kwName}\` is passed more than once — this raises a TypeError at runtime.`,
            sourceCode,
            `Remove the duplicate \`${kwName}=...\` argument.`,
          )
        }
        seen.add(kwName)
      }
    }

    return null
  },
}
