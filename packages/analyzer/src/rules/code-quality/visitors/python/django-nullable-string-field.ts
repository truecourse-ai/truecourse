import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const STRING_FIELD_TYPES = new Set(['CharField', 'TextField', 'EmailField', 'URLField', 'SlugField', 'GenericIPAddressField', 'IPAddressField', 'FilePathField', 'UUIDField'])

export const pythonDjangoNullableStringFieldVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/django-nullable-string-field',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let fieldType: string | null = null
    if (fn.type === 'identifier' && STRING_FIELD_TYPES.has(fn.text)) {
      fieldType = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr && STRING_FIELD_TYPES.has(attr.text)) fieldType = attr.text
    }
    if (!fieldType) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const hasNullTrue = args.namedChildren.some((a) => {
      if (a.type !== 'keyword_argument') return false
      const key = a.childForFieldName('name')
      const val = a.childForFieldName('value')
      return key?.text === 'null' && val?.text === 'True'
    })

    if (!hasNullTrue) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Django nullable string field',
      `\`${fieldType}\` with \`null=True\` — Django uses empty string for "no value" on string fields. Use \`blank=True\` instead.`,
      sourceCode,
      'Replace `null=True` with `blank=True, default=""` on string-based Django fields.',
    )
  },
}
