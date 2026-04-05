import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Generic types from typing module that should have type parameters
const PARAMETERIZABLE_TYPES = new Set([
  'List', 'Dict', 'Set', 'FrozenSet', 'Tuple', 'Type',
  'Optional', 'Union', 'Callable', 'Iterator', 'Generator',
  'Iterable', 'Sequence', 'Mapping', 'MutableMapping',
  'MutableSequence', 'MutableSet', 'AbstractSet',
  'Deque', 'DefaultDict', 'OrderedDict', 'Counter', 'ChainMap',
  'Awaitable', 'Coroutine', 'AsyncIterator', 'AsyncIterable',
  'AsyncGenerator', 'ContextManager', 'AsyncContextManager',
  'ClassVar', 'Final', 'Literal',
])

export const pythonGenericTypeUnparameterizedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/generic-type-unparameterized',
  languages: ['python'],
  nodeTypes: ['type'],
  visit(node, filePath, sourceCode) {
    // A bare type annotation (not subscript) that is a parameterizable type
    const inner = node.namedChildren[0]
    if (!inner) return null

    // We want bare identifiers, not subscripts (subscript means it HAS params)
    if (inner.type !== 'identifier') return null
    if (!PARAMETERIZABLE_TYPES.has(inner.text)) return null

    // Make sure the parent is not a subscript (which would mean it already has params)
    if (node.parent?.type === 'subscript') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Generic type without parameters',
      `\`${inner.text}\` is used as a type annotation without type parameters. This provides incomplete type information.`,
      sourceCode,
      `Add type parameters: \`${inner.text}[SomeType]\`. On Python 3.9+, you can use the built-in \`${inner.text.toLowerCase()}\` instead.`,
    )
  },
}
