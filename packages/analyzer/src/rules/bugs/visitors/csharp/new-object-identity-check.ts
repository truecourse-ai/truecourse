import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const FRESH_OBJECT_TYPES = new Set([
  'object_creation_expression',
  'implicit_object_creation_expression',
  'array_creation_expression',
  'implicit_array_creation_expression',
  'anonymous_object_creation_expression',
])

/**
 * `ReferenceEquals(new Foo(), x)` — a freshly constructed object cannot be
 * reference-equal to anything that existed before the call, so the check
 * is always false.
 *
 * `==` with a new object is NOT flagged: operator overloads (string,
 * records) make it value equality.
 */
export const csharpNewObjectIdentityCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/new-object-identity-check',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null
    const name = fn.type === 'identifier'
      ? fn.text
      : fn.type === 'member_access_expression'
        ? (fn.childForFieldName('name')?.text ?? '')
        : ''
    if (name !== 'ReferenceEquals') return null

    const args = node.childForFieldName('arguments')?.namedChildren ?? []
    if (args.length !== 2) return null

    const fresh = args
      .map((a) => a?.namedChildren[0])
      .find((expr) => expr && FRESH_OBJECT_TYPES.has(expr.type))
    if (!fresh) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Identity check on new object',
      `\`${node.text}\` — \`${fresh.text}\` constructs a brand-new object, so \`ReferenceEquals\` is always \`false\`.`,
      sourceCode,
      'Use Equals()/== for value equality, or store the object in a variable before comparing references.',
    )
  },
}
