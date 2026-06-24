import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { csharpFindAttribute, csharpAttributeHasNamedArg } from './_attr-helpers.js'

/**
 * `[ExcludeFromCodeCoverage]` carves a member out of coverage reporting. Without
 * a `Justification`, the reason coverage is waived is invisible to reviewers.
 * The check fires on a declaration whose `[ExcludeFromCodeCoverage]` attribute
 * lacks a non-empty `Justification = "…"` named argument.
 */
const NAMES = new Set(['ExcludeFromCodeCoverage'])

const DECL_TYPES = [
  'method_declaration', 'class_declaration', 'struct_declaration', 'record_declaration',
  'property_declaration', 'constructor_declaration', 'field_declaration',
]

export const csharpExcludeFromCoverageWithoutJustificationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/excludefromcoverage-without-justification',
  languages: ['csharp'],
  nodeTypes: DECL_TYPES,
  visit(node, filePath, sourceCode) {
    const attr = csharpFindAttribute(node, NAMES)
    if (!attr) return null
    if (csharpAttributeHasNamedArg(attr, 'Justification')) return null

    return makeViolation(
      this.ruleKey, attr, filePath, 'low',
      'ExcludeFromCodeCoverage without justification',
      '`[ExcludeFromCodeCoverage]` is applied without a `Justification`, hiding why coverage is waived.',
      sourceCode,
      'Add a `Justification = "…"` argument explaining why the member is excluded from coverage.',
    )
  },
}
