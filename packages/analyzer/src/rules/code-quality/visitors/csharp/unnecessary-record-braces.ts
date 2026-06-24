import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A positional record followed by an empty `{ }` body adds nothing over
 * terminating the declaration with a semicolon. The empty block is misleading
 * noise that suggests the record has additional members when it does not. The
 * check fires on a `record_declaration` (or `record_struct_declaration`) that
 * has a positional `parameter_list` and a `declaration_list` body with no
 * members.
 */
export const csharpUnnecessaryRecordBracesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-record-braces',
  languages: ['csharp'],
  nodeTypes: ['record_declaration', 'record_struct_declaration'],
  visit(node, filePath, sourceCode) {
    const hasParams = node.namedChildren.some((c) => c?.type === 'parameter_list')
    if (!hasParams) return null

    const body = node.childForFieldName('body')
      ?? node.namedChildren.find((c) => c?.type === 'declaration_list')
    if (!body || body.type !== 'declaration_list') return null
    if (body.namedChildCount > 0) return null

    const name = node.childForFieldName('name')?.text ?? 'record'
    return makeViolation(
      this.ruleKey, body, filePath, 'low',
      'Unnecessary record braces',
      `Positional record \`${name}\` has an empty \`{ }\` body that adds nothing over ending the declaration with a semicolon.`,
      sourceCode,
      'Remove the empty `{ }` and terminate the record with `;`.',
    )
  },
}
