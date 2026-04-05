import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const requireImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-import',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'require') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length === 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'require() in TypeScript',
      '`require()` is CommonJS syntax. Use ES module `import` syntax in TypeScript files.',
      sourceCode,
      'Replace `const x = require("module")` with `import x from "module"`.',
    )
  },
}
