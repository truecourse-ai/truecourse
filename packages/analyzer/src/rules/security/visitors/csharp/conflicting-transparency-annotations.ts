import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributes } from './_helpers.js'

/**
 * A member carrying contradictory security-transparency attributes —
 * `[SecurityCritical]` together with `[SecuritySafeCritical]` or
 * `[SecurityTransparent]`. The combination is an undefined security posture:
 * the type can be both "trusted to call critical code" and "must not", and the
 * runtime's resolution is non-obvious.
 */
const TRANSPARENCY_ATTRS = ['SecurityCritical', 'SecuritySafeCritical', 'SecurityTransparent']
const DECL_NODES = [
  'class_declaration', 'struct_declaration', 'interface_declaration',
  'method_declaration', 'constructor_declaration', 'property_declaration',
  'field_declaration', 'event_declaration',
]

export const csharpConflictingTransparencyAnnotationsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/conflicting-transparency-annotations',
  languages: ['csharp'],
  nodeTypes: DECL_NODES,
  visit(node, filePath, sourceCode) {
    const present = new Set(
      getCSharpAttributes(node).map((a) => a.name).filter((n) => TRANSPARENCY_ATTRS.includes(n)),
    )
    if (present.size < 2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Conflicting transparency annotations',
      'This member carries contradictory security-transparency attributes, leaving its security posture undefined.',
      sourceCode,
      'Keep a single transparency attribute (SecurityCritical, SecuritySafeCritical, or SecurityTransparent).',
    )
  },
}
