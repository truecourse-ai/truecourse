import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDefaultdictDefaultFactoryKwargVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/defaultdict-default-factory-kwarg',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const isDefaultdict =
      (fn.type === 'identifier' && fn.text === 'defaultdict') ||
      (fn.type === 'attribute' && fn.childForFieldName('attribute')?.text === 'defaultdict')
    if (!isDefaultdict) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const kw = arg.childForFieldName('name')
        if (kw?.text === 'default_factory') {
          return makeViolation(
            this.ruleKey, arg, filePath, 'high',
            'defaultdict with default_factory as keyword argument',
            `\`defaultdict(default_factory=...)\` — the factory must be the first positional argument, not a keyword. The keyword argument is silently ignored and the defaultdict has no factory.`,
            sourceCode,
            `Change to positional: \`defaultdict(${arg.childForFieldName('value')?.text ?? 'list'})\`.`,
          )
        }
      }
    }
    return null
  },
}
