import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  isPydanticFieldCall,
  isSqlAlchemyColumnCall,
  isSqlAlchemyMappedAnnotation,
} from '../../../_shared/python-framework-detection.js'

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

/**
 * True if `node` is a direct class-body assignment — i.e., the nearest
 * enclosing definition is a `class_definition`, not a `function_definition`.
 *
 * Class attributes don't actually shadow Python built-ins: they live in the
 * class namespace and are accessed via `self.id` or `Foo.id`, which never
 * collides with the module-level `id()` function. Pydantic / SQLAlchemy /
 * dataclasses / plain classes all use `id: int`, `type: str`, etc. as
 * idiomatic field names, and flagging these is a false positive.
 *
 * Walks up parents and stops at the first function_definition (false — inside
 * a method, still production code) or class_definition (true — class body).
 */
function isInsideClassBody(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'function_definition' || current.type === 'lambda') return false
    if (current.type === 'class_definition') return true
    current = current.parent
  }
  return false
}

export const pythonBuiltinShadowingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/builtin-shadowing',
  languages: ['python'],
  nodeTypes: ['assignment', 'named_expression', 'parameters'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'assignment') {
      const left = node.childForFieldName('left')
      if (!left) return null
      if (left.type === 'identifier' && PYTHON_BUILTINS.has(left.text)) {
        // Skip any assignment in a class body — class attributes don't
        // shadow built-ins (they live in the class namespace, accessed via
        // `self.id` / `Foo.id` which doesn't collide with `id()`). This
        // covers Pydantic, SQLAlchemy, dataclasses, and plain classes.
        if (isInsideClassBody(node)) return null

        // The remaining module-level / function-level assignments are the
        // ones that actually shadow built-ins. Some common idioms still
        // need to be skipped:

        // Skip Pydantic Field() calls at module level (rare but valid when
        // creating standalone Field objects for reuse).
        const right = node.childForFieldName('right')
        if (right && isPydanticFieldCall(right)) return null

        // Skip SQLAlchemy column declarations at module level (Table(...)
        // style uses mapped_column / Column as positional args, but some
        // projects declare column objects at module scope for reuse).
        if (right && isSqlAlchemyColumnCall(right)) return null

        // Skip any assignment with a `Mapped[...]` type annotation.
        const annotation = node.childForFieldName('type')
        if (annotation && isSqlAlchemyMappedAnnotation(annotation)) return null

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
