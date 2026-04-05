import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDjangoRawSqlVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/django-raw-sql',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (methodName !== 'raw' && methodName !== 'extra') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag f-string interpolation or string concatenation in the SQL argument
    const isUnsafe =
      (firstArg.type === 'string' && firstArg.text.startsWith('f')) ||
      firstArg.type === 'binary_operator' ||
      firstArg.type === 'call' // e.g., format()

    if (isUnsafe || firstArg.type !== 'none') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Django raw SQL query',
        `${methodName}() bypasses Django ORM protections. Ensure the query is not built from user input.`,
        sourceCode,
        'Avoid raw() and extra(). Use Django ORM queryset methods or parameterized queries.',
      )
    }

    return null
  },
}
