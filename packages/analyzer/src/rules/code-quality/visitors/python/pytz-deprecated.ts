import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPytzDeprecatedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytz-deprecated',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        const name = child.type === 'dotted_name' ? child.text :
                     child.type === 'aliased_import' ? child.namedChildren[0]?.text : null
        if (name === 'pytz') {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'pytz usage in Python 3.9+',
            '`pytz` is a legacy timezone library with known edge cases around DST transitions. Python 3.9+ includes the `zoneinfo` module as the standard replacement.',
            sourceCode,
            'Replace `import pytz` with `from zoneinfo import ZoneInfo` and update timezone usage accordingly.',
          )
        }
      }
    }

    if (node.type === 'import_from_statement') {
      const module = node.childForFieldName('module_name') ?? node.namedChildren[0]
      if (module?.text === 'pytz' || module?.text?.startsWith('pytz.')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'pytz usage in Python 3.9+',
          '`pytz` is a legacy timezone library. Python 3.9+ includes `zoneinfo.ZoneInfo` as the standard replacement.',
          sourceCode,
          'Replace pytz imports with `from zoneinfo import ZoneInfo`.',
        )
      }
    }

    return null
  },
}
