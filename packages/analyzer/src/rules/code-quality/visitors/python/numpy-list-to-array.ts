import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNumpyListToArrayVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/numpy-list-to-array',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if ((obj?.text !== 'np' && obj?.text !== 'numpy') || attr?.text !== 'array') return null

    // In tree-sitter Python, generator_expression in a function call can be
    // either inside argument_list OR as a direct child of the call node
    const args = node.childForFieldName('arguments')

    // Check direct call children (generator_expression as direct child)
    for (const child of node.namedChildren) {
      if (child.type === 'generator_expression') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Generator passed to np.array()',
          '`np.array()` does not fully consume generators — it creates an array of object type with the generator as a single element. Pass a list instead.',
          sourceCode,
          'Replace `np.array(gen_expr)` with `np.array(list(gen_expr))` or use `np.fromiter()` for memory-efficient conversion.',
        )
      }
    }

    if (!args) return null

    const firstArg = args.namedChildren.filter((c) => c.type !== 'keyword_argument')[0]
    if (!firstArg) return null

    // Check if arg is a generator expression (within argument_list)
    if (firstArg.type === 'generator_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Generator passed to np.array()',
        '`np.array()` does not fully consume generators — it creates an array of object type with the generator as a single element. Pass a list instead.',
        sourceCode,
        'Replace `np.array(gen_expr)` with `np.array(list(gen_expr))` or use `np.fromiter()` for memory-efficient conversion.',
      )
    }

    return null
  },
}
