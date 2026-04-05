import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Map from dunder method to recommended builtin/syntax
const DUNDER_TO_BUILTIN: Record<string, string> = {
  __len__: 'len(x)',
  __str__: 'str(x)',
  __repr__: 'repr(x)',
  __int__: 'int(x)',
  __float__: 'float(x)',
  __bool__: 'bool(x)',
  __bytes__: 'bytes(x)',
  __abs__: 'abs(x)',
  __hash__: 'hash(x)',
  __iter__: 'iter(x)',
  __next__: 'next(x)',
  __reversed__: 'reversed(x)',
  __contains__: 'x in container',
  __add__: 'x + y',
  __sub__: 'x - y',
  __mul__: 'x * y',
  __truediv__: 'x / y',
  __floordiv__: 'x // y',
  __mod__: 'x % y',
  __lt__: 'x < y',
  __le__: 'x <= y',
  __eq__: 'x == y',
  __ne__: 'x != y',
  __gt__: 'x > y',
  __ge__: 'x >= y',
}

export const pythonUnnecessaryDunderCallVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-dunder-call',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr) return null

    const dunderName = attr.text
    if (!/^__\w+__$/.test(dunderName)) return null

    const builtin = DUNDER_TO_BUILTIN[dunderName]
    if (!builtin) return null

    const obj = fn.childForFieldName('object')
    const objText = obj?.text ?? 'x'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary dunder method call',
      `\`${objText}.${dunderName}()\` calls a dunder method directly. Use the corresponding builtin or operator instead.`,
      sourceCode,
      `Replace \`${objText}.${dunderName}()\` with \`${builtin.replace('x', objText)}\`.`,
    )
  },
}
