import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function getNpRandomMethod(node: SyntaxNode): string | null {
  // np.random.seed, np.random.RandomState, np.random.rand, etc.
  if (node.type !== 'attribute') return null
  const obj = node.childForFieldName('object')
  const attr = node.childForFieldName('attribute')
  if (!obj || !attr) return null

  if (obj.type === 'attribute') {
    const objObj = obj.childForFieldName('object')
    const objAttr = obj.childForFieldName('attribute')
    if ((objObj?.text === 'np' || objObj?.text === 'numpy') && objAttr?.text === 'random') {
      return attr.text
    }
  }
  return null
}

const LEGACY_RANDOM_METHODS = new Set(['seed', 'RandomState', 'rand', 'randn', 'randint', 'random_sample', 'choice', 'shuffle', 'permutation'])

export const pythonNumpyLegacyRandomVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/numpy-legacy-random',
  languages: ['python'],
  nodeTypes: ['attribute', 'call'],
  visit(node, filePath, sourceCode) {
    let method: string | null = null

    if (node.type === 'attribute') {
      method = getNpRandomMethod(node)
      // Avoid flagging the attribute inside a call_expression multiple times
      if (node.parent?.type === 'call') return null
    } else if (node.type === 'call') {
      const fn = node.childForFieldName('function')
      if (fn) method = getNpRandomMethod(fn)
    }

    if (!method || !LEGACY_RANDOM_METHODS.has(method)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'NumPy legacy random API',
      `\`np.random.${method}\` uses the legacy random API. Use \`np.random.default_rng()\` for a Generator-based API that is more reproducible and feature-complete.`,
      sourceCode,
      'Replace the legacy random call with `rng = np.random.default_rng(seed)` and then `rng.' + method + '(...)`.',
    )
  },
}
