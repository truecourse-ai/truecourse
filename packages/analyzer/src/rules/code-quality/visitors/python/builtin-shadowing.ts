import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_BUILTINS = new Set([
  'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray', 'bytes',
  'callable', 'chr', 'classmethod', 'compile', 'complex', 'copyright', 'credits',
  'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'exit',
  'filter', 'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr',
  'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass',
  'iter', 'len', 'license', 'list', 'locals', 'map', 'max', 'memoryview', 'min',
  'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'quit',
  'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted',
  'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip',
])

export const pythonBuiltinShadowingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/builtin-shadowing',
  languages: ['python'],
  nodeTypes: ['assignment', 'named_expression', 'parameters'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'assignment') {
      const left = node.childForFieldName('left')
      if (!left) return null
      if (left.type === 'identifier' && PYTHON_BUILTINS.has(left.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Built-in name shadowed',
          `Assignment shadows the Python built-in \`${left.text}\`. Choose a different variable name.`,
          sourceCode,
          `Rename the variable to avoid shadowing the built-in \`${left.text}\`.`,
        )
      }
    }
    return null
  },
}
