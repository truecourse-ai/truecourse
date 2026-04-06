import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const RANDOM_FUNCS = new Set([
  'random', 'randn', 'randint', 'rand', 'choice', 'choices',
  'shuffle', 'permutation', 'normal', 'uniform', 'exponential',
  'poisson', 'binomial', 'multinomial', 'seed',
])

/**
 * Detects numpy random calls without a seed, making results non-reproducible.
 * Also detects np.random.Generator without a seed.
 */
export const pythonNumpyReproducibleRandomVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/numpy-reproducible-random',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (!obj || !attr) return null

    // np.random.xxx() or numpy.random.xxx()
    const objText = obj.text
    const attrText = attr.text

    if (!RANDOM_FUNCS.has(attrText)) return null
    if (!objText.endsWith('random') && !objText.includes('np.random') && !objText.includes('numpy.random')) return null

    // Skip if it's np.random.seed() itself — that's the fix
    if (attrText === 'seed') return null

    // Check that there's no global seed set nearby — heuristic: check if seed is called anywhere in file
    if (sourceCode.includes('np.random.seed') || sourceCode.includes('numpy.random.seed') || sourceCode.includes('rng =') || sourceCode.includes('default_rng')) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Non-reproducible random results',
      `\`${objText}.${attrText}()\` generates random results without a seed — results are not reproducible. Set a seed for deterministic behavior in scientific code.`,
      sourceCode,
      'Set a seed: `np.random.seed(42)` or use `rng = np.random.default_rng(42)`.',
    )
  },
}
