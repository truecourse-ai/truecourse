import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `items.ToDictionary(x => "constant", …)` — a constant key selector
 * produces the same key for every element, so the call throws
 * ArgumentException ("An item with the same key has already been added")
 * as soon as the source has a second element.
 */
const LITERAL_KEY_TYPES = new Set([
  'string_literal',
  'verbatim_string_literal',
  'raw_string_literal',
  'integer_literal',
  'real_literal',
  'character_literal',
  'boolean_literal',
])

export const csharpStaticKeyDictComprehensionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/static-key-dict-comprehension',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const name = fn.childForFieldName('name')
    const method = name?.type === 'generic_name'
      ? (name.namedChildren.find((c) => c?.type === 'identifier')?.text ?? '')
      : (name?.text ?? '')
    if (method !== 'ToDictionary') return null

    const keySelector = node.childForFieldName('arguments')?.namedChildren[0]?.namedChildren[0]
    if (keySelector?.type !== 'lambda_expression') return null
    const keyBody = keySelector.childForFieldName('body')
    if (!keyBody || !LITERAL_KEY_TYPES.has(keyBody.type)) return null

    return makeViolation(
      this.ruleKey, keySelector, filePath, 'high',
      'Static key in dict comprehension',
      `\`ToDictionary\` with the constant key \`${keyBody.text}\` maps every element to the same key — it throws \`ArgumentException\` as soon as the source has more than one element.`,
      sourceCode,
      'Select a key from the element (e.g. `x => x.Id`), or use a different collection if all values share one key.',
    )
  },
}
