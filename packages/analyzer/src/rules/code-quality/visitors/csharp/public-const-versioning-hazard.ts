import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A `public const` value is inlined into consuming assemblies at compile time,
 * so changing it does not take effect until every consumer recompiles —
 * a silent versioning hazard. `static readonly` is read at runtime and updates
 * for consumers on assembly swap. The check fires on a `public` (or
 * `protected`) `const` `field_declaration` on a type. Private/internal consts
 * never cross an assembly boundary and are left alone.
 */
export const csharpPublicConstVersioningHazardVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/public-const-versioning-hazard',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'const')) return null
    if (!hasCSharpModifier(node, 'public') && !hasCSharpModifier(node, 'protected')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Public constant versioning hazard',
      'A `public const` value is inlined into consumers at compile time and will not update unless they recompile — prefer `static readonly`.',
      sourceCode,
      'Replace the `public const` with a `public static readonly` field.',
    )
  },
}
