import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { importsPandas } from '../../../_shared/python-framework-detection.js'

/**
 * Detects pandas accessor style preferences (pandas-vet rules):
 * - PD008: .at accessor → use .loc
 * - PD009: .iat accessor → use .iloc
 * - PD010: .pivot() or .unstack() → use .pivot_table()
 * - PD012: .read_table() → use .read_csv()
 * - PD013: .stack() → use .melt()
 */

const AT_TO_LOC = new Set(['at'])
const IAT_TO_ILOC = new Set(['iat'])
const PIVOT_PREFERRED = new Set(['pivot', 'unstack'])
const STACK_PREFERRED = new Set(['stack'])

export const pythonPandasAccessorPreferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pandas-accessor-preference',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    // Gate on file actually using pandas. The method names `.at`, `.iat`,
    // `.stack()`, `.pivot()`, `.read_table()` are all extremely generic and
    // collide with non-pandas code.
    if (!importsPandas(node)) return null

    const attr = node.childForFieldName('attribute')
    if (!attr) return null

    const attrName = attr.text
    const parent = node.parent

    // Only flag when the attribute is being used in a subscript or call
    if (!parent) return null
    const isUsed = parent.type === 'subscript' || parent.type === 'call'
    if (!isUsed) return null

    // PD008: .at[...] → .loc[...]
    if (AT_TO_LOC.has(attrName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Pandas accessor preference: .at → .loc',
        '`.at` accessor should be replaced with `.loc` for consistency.',
        sourceCode,
        'Replace `.at[...]` with `.loc[...]`.',
      )
    }

    // PD009: .iat[...] → .iloc[...]
    if (IAT_TO_ILOC.has(attrName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Pandas accessor preference: .iat → .iloc',
        '`.iat` accessor should be replaced with `.iloc` for consistency.',
        sourceCode,
        'Replace `.iat[...]` with `.iloc[...]`.',
      )
    }

    // PD010: .pivot() or .unstack() → .pivot_table()
    if (PIVOT_PREFERRED.has(attrName) && parent.type === 'call') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `Pandas accessor preference: .${attrName}() → .pivot_table()`,
        `\`.${attrName}()\` should be replaced with \`.pivot_table()\` for more flexibility.`,
        sourceCode,
        `Replace \`.${attrName}()\` with \`.pivot_table()\`.`,
      )
    }

    // PD013: .stack() → .melt()
    if (STACK_PREFERRED.has(attrName) && parent.type === 'call') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Pandas accessor preference: .stack() → .melt()',
        '`.stack()` should be replaced with `.melt()` for clearer semantics.',
        sourceCode,
        'Replace `.stack()` with `.melt()`.',
      )
    }

    // PD012: pd.read_table() → pd.read_csv()
    if (attrName === 'read_table' && parent.type === 'call') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Pandas accessor preference: .read_table() → .read_csv()',
        '`pd.read_table()` should be replaced with `pd.read_csv()` for consistency.',
        sourceCode,
        'Replace `pd.read_table()` with `pd.read_csv(sep="\\t")` or similar.',
      )
    }

    return null
  },
}
