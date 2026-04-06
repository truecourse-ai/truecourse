import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

const CHAIN_THRESHOLD = 4

/**
 * Detects long chains of DataFrame method calls (> 4 chained) — suggest pandas.pipe().
 */
export const pythonPandasPipePreferredVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pandas-pipe-preferred',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node: SyntaxNode, filePath, sourceCode) {
    // Count chained attribute calls
    let depth = 0
    let cur: SyntaxNode | null = node
    while (cur && cur.type === 'call') {
      const fn = cur.childForFieldName('function')
      if (!fn || fn.type !== 'attribute') break
      depth++
      cur = fn.childForFieldName('object') ?? null
    }

    if (depth < CHAIN_THRESHOLD) return null

    // Only flag if it looks like a DataFrame (contains known pandas methods)
    const fullText = node.text
    const pandasMethods = ['groupby', 'merge', 'join', 'agg', 'apply', 'transform', 'filter', 'sort_values', 'drop_duplicates', 'fillna', 'dropna', 'rename', 'assign', 'reset_index', 'set_index', 'pivot', 'melt', 'stack', 'unstack']
    const hasPandasMethod = pandasMethods.some((m) => fullText.includes(`.${m}(`))
    if (!hasPandasMethod) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Long pandas method chain',
      `DataFrame has ${depth} chained method calls — use \`pandas.pipe()\` to break the chain into named steps for readability.`,
      sourceCode,
      'Break the chain using `df.pipe(step1).pipe(step2)...` for readability.',
    )
  },
}
