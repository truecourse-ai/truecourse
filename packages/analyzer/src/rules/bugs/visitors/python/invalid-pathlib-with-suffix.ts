import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: Path(...).with_suffix("txt") — missing leading dot
// Path.with_suffix() argument must start with '.' or be empty string
export const pythonInvalidPathlibWithSuffixVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-pathlib-with-suffix',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func || func.type !== 'attribute') return null

    const attr = func.childForFieldName('attribute')
    if (!attr || attr.text !== 'with_suffix') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Only check string literals
    if (firstArg.type !== 'string') return null

    // Extract the string value (remove quotes)
    const raw = firstArg.text
    const value = raw.slice(1, -1) // strip surrounding quotes

    // Valid: starts with '.' or is empty string
    if (value === '' || value.startsWith('.')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Invalid Path.with_suffix() argument',
      `\`with_suffix(${raw})\` argument must start with \`.\` — got ${raw} which will raise ValueError at runtime.`,
      sourceCode,
      `Change to \`with_suffix(".${value}")\` to add the required leading dot.`,
    )
  },
}
