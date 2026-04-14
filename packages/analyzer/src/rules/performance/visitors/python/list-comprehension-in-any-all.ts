import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const listCompInAnyAllVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/list-comprehension-in-any-all',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    if (fn.text !== 'any' && fn.text !== 'all') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'list_comprehension') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `List comprehension in ${fn.text}()`,
        `${fn.text}([...]) creates the entire list before checking. Use a generator expression ${fn.text}(... for ...) for short-circuit evaluation.`,
        sourceCode,
        `Replace the list comprehension [...] with a generator expression (...) inside ${fn.text}().`,
      )
    }

    return null
  },
}
