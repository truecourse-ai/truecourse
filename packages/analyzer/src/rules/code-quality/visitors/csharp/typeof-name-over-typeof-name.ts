import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `typeof(X).Name` performs a runtime reflection lookup to recover a name the
 * compiler already knows; `nameof(X)` yields the same string as a compile-time
 * constant and survives a rename (IDE0082). The check targets a
 * `member_access_expression` whose receiver is a `typeof_expression` and whose
 * member is exactly `Name`.
 *
 * `FullName`, `AssemblyQualifiedName`, etc. are intentionally not matched —
 * only `.Name` has a `nameof` equivalent.
 */

export const csharpTypeofNameOverTypeofNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/typeof-name-over-typeof-name',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'Name') return null
    const receiver = node.childForFieldName('expression')
    if (receiver?.type !== 'typeof_expression') return null

    const typeArg = receiver.namedChildren.find(Boolean)?.text ?? 'X'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Convert typeof().Name to nameof',
      `\`typeof(${typeArg}).Name\` is a runtime reflection lookup; \`nameof(${typeArg})\` produces the same string at compile time and survives renames (IDE0082).`,
      sourceCode,
      `Replace \`typeof(${typeArg}).Name\` with \`nameof(${typeArg})\`.`,
    )
  },
}
