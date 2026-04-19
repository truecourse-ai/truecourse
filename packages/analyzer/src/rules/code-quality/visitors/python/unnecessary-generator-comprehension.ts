import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryGeneratorComprehensionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-generator-comprehension',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    const constructor = fn.text
    if (constructor !== 'list' && constructor !== 'set' && constructor !== 'dict') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // tree-sitter may parse list(x for x in ...) with generator_expression as
    // the arguments field itself (not inside argument_list)
    let arg: import('web-tree-sitter').Node | null = null
    if (args.type === 'generator_expression') {
      arg = args
    } else if (args.type === 'argument_list') {
      const positional = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
      if (positional.length !== 1) return null
      arg = positional[0]
    } else {
      return null
    }

    // Check for generator_expression inside list() / set()
    if (constructor === 'list' && arg.type === 'generator_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary generator in list()',
        '`list(x for x in ...)` can be written as `[x for x in ...]` — list comprehension is faster and clearer.',
        sourceCode,
        'Replace `list(generator)` with a list comprehension `[...]`.',
      )
    }
    if (constructor === 'set' && arg.type === 'generator_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary generator in set()',
        '`set(x for x in ...)` can be written as `{x for x in ...}` — set comprehension is faster and clearer.',
        sourceCode,
        'Replace `set(generator)` with a set comprehension `{...}`.',
      )
    }
    if (constructor === 'dict' && arg.type === 'generator_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary generator in dict()',
        '`dict(...)` with a generator can be written as a dict comprehension `{k: v for ...}`.',
        sourceCode,
        'Replace `dict(generator)` with a dict comprehension `{k: v for ...}`.',
      )
    }
    return null
  },
}
