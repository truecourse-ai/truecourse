import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// typing module types that have Python 3.9+ built-in equivalents
const LEGACY_TYPING_MAP: Record<string, string> = {
  'List': 'list',
  'Dict': 'dict',
  'Set': 'set',
  'FrozenSet': 'frozenset',
  'Tuple': 'tuple',
  'Type': 'type',
  'Deque': 'collections.deque',
  'DefaultDict': 'collections.defaultdict',
  'OrderedDict': 'collections.OrderedDict',
  'Counter': 'collections.Counter',
  'ChainMap': 'collections.ChainMap',
}

export const pythonLegacyTypeHintSyntaxVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/legacy-type-hint-syntax',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    const attr = node.childForFieldName('attribute')
    if (!obj || !attr) return null

    if (obj.text !== 'typing') return null

    const modernEquivalent = LEGACY_TYPING_MAP[attr.text]
    if (!modernEquivalent) return null

    // Check if used in type annotation context
    const parent = node.parent
    const grandParent = parent?.parent
    const inAnnotation = parent?.type === 'type' ||
      grandParent?.type === 'typed_parameter' ||
      grandParent?.type === 'typed_default_parameter' ||
      parent?.type === 'subscript' ||
      parent?.type === 'return_type'

    if (!inAnnotation) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Legacy type hint syntax',
      `\`typing.${attr.text}\` is a legacy type hint. On Python 3.9+, use the built-in \`${modernEquivalent}\` directly.`,
      sourceCode,
      `Replace \`typing.${attr.text}\` with \`${modernEquivalent}\` (Python 3.9+) or remove the \`typing.\` prefix.`,
    )
  },
}
