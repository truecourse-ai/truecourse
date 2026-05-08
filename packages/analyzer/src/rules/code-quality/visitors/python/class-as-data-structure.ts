import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function getMethodNames(classBody: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of classBody.namedChildren) {
    let funcNode: SyntaxNode | null = null
    if (child.type === 'function_definition') funcNode = child
    else if (child.type === 'decorated_definition') {
      funcNode = child.namedChildren.find((c) => c.type === 'function_definition') ?? null
    }
    if (funcNode) {
      const name = funcNode.childForFieldName('name')
      if (name) names.push(name.text)
    }
  }
  return names
}

// Built-in exception classes and common framework exception bases. A
// subclass of one of these is a polymorphism marker for `except X`/`raise`,
// not a data container — `@dataclass` would not be a meaningful migration.
const EXCEPTION_BASE_NAMES = new Set<string>([
  'Exception', 'BaseException', 'ArithmeticError', 'AssertionError',
  'AttributeError', 'BufferError', 'EOFError', 'ImportError',
  'IndexError', 'KeyError', 'KeyboardInterrupt', 'LookupError',
  'MemoryError', 'NameError', 'NotImplementedError', 'OSError',
  'OverflowError', 'ReferenceError', 'RuntimeError', 'StopIteration',
  'StopAsyncIteration', 'SyntaxError', 'SystemError', 'SystemExit',
  'TypeError', 'UnicodeError', 'ValueError', 'ZeroDivisionError',
  'FileNotFoundError', 'FileExistsError', 'PermissionError',
  'TimeoutError', 'IsADirectoryError', 'NotADirectoryError',
  'BlockingIOError', 'BrokenPipeError', 'ChildProcessError',
  'ConnectionError', 'ConnectionAbortedError', 'ConnectionRefusedError',
  'ConnectionResetError', 'InterruptedError', 'ProcessLookupError',
  // FastAPI / Starlette
  'HTTPException', 'WebSocketException', 'StarletteHTTPException',
  // Pydantic
  'ValidationError', 'PydanticUserError',
])

function isExceptionSubclass(node: SyntaxNode): boolean {
  // Class name ends with Error/Exception → strong convention for exception types.
  const name = node.childForFieldName('name')?.text ?? ''
  if (/(?:Error|Exception|Failure)$/.test(name)) return true

  // Direct base in the EXCEPTION_BASE_NAMES set — handles
  // `class Foo(Exception)`, `class Foo(HTTPException)`, etc.
  const supers = node.childForFieldName('superclasses')
  if (!supers) return false
  for (const arg of supers.namedChildren) {
    if (arg.type === 'identifier' && EXCEPTION_BASE_NAMES.has(arg.text)) return true
    // Qualified bases like `starlette.exceptions.HTTPException`
    if (arg.type === 'attribute') {
      const tail = arg.childForFieldName('attribute')?.text
      if (tail && EXCEPTION_BASE_NAMES.has(tail)) return true
    }
  }
  return false
}

export const pythonClassAsDataStructureVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/class-as-data-structure',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    if (isExceptionSubclass(node)) return null

    // Skip when the class composes Mixin base classes — its
    // methods come from the mixins, not from its own body, so
    // it is NOT a data container.
    {
      const supers = node.childForFieldName('superclasses')
      if (supers) {
        let mixinCount = 0
        for (const arg of supers.namedChildren) {
          const text = arg.type === 'identifier' ? arg.text :
            arg.type === 'attribute' ? arg.childForFieldName('attribute')?.text ?? '' :
            ''
          if (/Mixin$/.test(text) || /Provider$/.test(text) || /Service$/.test(text)) {
            mixinCount++
          }
        }
        if (mixinCount >= 1) return null
      }
    }

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    const methods = getMethodNames(bodyNode)

    // Only has __init__ (and optionally __repr__/__eq__)
    const nonTrivialMethods = methods.filter((m) => !['__init__', '__repr__', '__str__', '__eq__', '__hash__'].includes(m))
    if (nonTrivialMethods.length > 0) return null
    if (!methods.includes('__init__')) return null
    if (methods.length > 1) return null // has more than just __init__

    // Check if __init__ only assigns attributes
    const initNode = bodyNode.namedChildren.find((c) => {
      if (c.type === 'function_definition') {
        return c.childForFieldName('name')?.text === '__init__'
      }
      return false
    })
    if (!initNode) return null

    const initBody = initNode.childForFieldName('body')
    if (!initBody) return null

    // Check all statements are self.x = y assignments
    const stmts = initBody.namedChildren
    if (stmts.length === 0) return null
    const allAssignments = stmts.every((s) => {
      if (s.type !== 'assignment' && s.type !== 'expression_statement') return false
      if (s.type === 'assignment') {
        const left = s.childForFieldName('left')
        return left?.type === 'attribute' && left.childForFieldName('object')?.text === 'self'
      }
      return true
    })
    if (!allAssignments) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'class'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Class used as plain data structure',
      `Class \`${name}\` has only \`__init__\` setting attributes — consider using \`@dataclass\` or \`NamedTuple\`.`,
      sourceCode,
      'Replace with `@dataclass` or `typing.NamedTuple` for cleaner data containers.',
    )
  },
}
