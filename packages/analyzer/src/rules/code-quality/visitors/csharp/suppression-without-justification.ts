import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { csharpFindAttribute, csharpAttributeHasNamedArg } from './_attr-helpers.js'

/**
 * A `[SuppressMessage]` that provides no `Justification` silences an analyzer
 * warning with no recorded reason, making the suppression unreviewable. The
 * check fires on a declaration whose `[SuppressMessage]` attribute lacks a
 * non-empty `Justification = "…"` named argument.
 */
const SUPPRESS_NAMES = new Set(['SuppressMessage'])

const DECL_TYPES = [
  'method_declaration', 'class_declaration', 'struct_declaration', 'record_declaration',
  'interface_declaration', 'property_declaration', 'field_declaration', 'constructor_declaration',
  'event_declaration', 'event_field_declaration', 'enum_declaration', 'delegate_declaration',
]

export const csharpSuppressionWithoutJustificationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/suppression-without-justification',
  languages: ['csharp'],
  nodeTypes: DECL_TYPES,
  visit(node, filePath, sourceCode) {
    const attr = csharpFindAttribute(node, SUPPRESS_NAMES)
    if (!attr) return null
    if (csharpAttributeHasNamedArg(attr, 'Justification')) return null

    return makeViolation(
      this.ruleKey, attr, filePath, 'medium',
      'Suppression without justification',
      'A `[SuppressMessage]` attribute provides no `Justification`, hiding why an analyzer warning was silenced and making the suppression unreviewable.',
      sourceCode,
      'Add a `Justification = "…"` named argument explaining why the diagnostic is suppressed.',
    )
  },
}
