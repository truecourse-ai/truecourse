import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

const MIGRATION_PATH_RE = /(?:[\\/]|^)(?:alembic|migrations)[\\/]versions[\\/]/i

// Bases that mark a class as a data container / framework
// extension where the class-docstring expectation is loose:
// fields are self-documenting, the framework defines the
// contract.
const DATA_CONTAINER_BASES = new Set([
  // Pydantic / SQLModel
  'BaseModel', 'OpenHandsModel', 'SQLModel',
  // Standard library data shapes
  'TypedDict', 'NamedTuple',
  // Enums
  'Enum', 'IntEnum', 'StrEnum', 'IntFlag', 'Flag', 'auto',
  // Abstract / protocol stubs
  'ABC', 'Protocol',
  // Logging adapters / filters / formatters — bodies follow
  // the documented stdlib override contract.
  'Filter', 'Formatter', 'LoggerAdapter',
  // ASGI / Starlette / FastAPI middleware base
  'BaseHTTPMiddleware', 'StaticFiles', 'Middleware',
])

// Decorators that imply a class is purely a data container or
// framework-managed (handled by the framework's own docstring
// conventions, not the user's).
const DATA_CONTAINER_DECORATORS = new Set([
  'dataclass', 'dataclasses.dataclass',
  'attrs.define', 'attrs.frozen', 'attr.s',
  'pydantic.dataclasses.dataclass',
])

// Method decorators that imply override / contract semantics —
// the parent class carries the docstring.
const OVERRIDE_DECORATORS = new Set([
  'override', 'overload', 'abstractmethod', 'abstractproperty',
  'final', 'classmethod', 'staticmethod', 'property',
  'cached_property',
])

function getDecoratorName(decorator: SyntaxNode): string {
  // decorator child: identifier | call | attribute
  for (const c of decorator.namedChildren) {
    if (c.type === 'identifier') return c.text
    if (c.type === 'attribute') {
      const attr = c.childForFieldName('attribute')
      return attr?.text ?? c.text
    }
    if (c.type === 'call') {
      const fn = c.childForFieldName('function')
      if (fn?.type === 'identifier') return fn.text
      if (fn?.type === 'attribute') return fn.childForFieldName('attribute')?.text ?? fn.text
    }
  }
  return ''
}

function getClassBaseNames(cls: SyntaxNode): string[] {
  const names: string[] = []
  const supers = cls.childForFieldName('superclasses')
  if (!supers) return names
  for (const c of supers.namedChildren) {
    if (c.type === 'identifier') {
      names.push(c.text)
      continue
    }
    if (c.type === 'attribute') {
      // foo.bar.Baz → terminal attribute
      const attr = c.childForFieldName('attribute')
      if (attr) names.push(attr.text)
      continue
    }
    if (c.type === 'subscript') {
      // Generic[T], Injector[T], Mixin[T] — capture base name
      const value = c.childForFieldName('value')
      if (value?.type === 'identifier') names.push(value.text)
      else if (value?.type === 'attribute') {
        const attr = value.childForFieldName('attribute')
        if (attr) names.push(attr.text)
      }
      continue
    }
  }
  return names
}

function classExtendsDataContainer(cls: SyntaxNode): boolean {
  const names = getClassBaseNames(cls)
  if (names.length === 0) return false
  for (const n of names) {
    if (DATA_CONTAINER_BASES.has(n)) return true
    // Heuristic: anything ending in "Mixin" is typically a
    // framework-DI / discriminator helper.
    if (/Mixin$/.test(n)) return true
    // Generic injector / store / repository protocol bases.
    if (/^(?:Injector|Store|Repository|Provider|Service)$/i.test(n)) return true
  }
  return false
}

function hasDataContainerDecorator(node: SyntaxNode): boolean {
  // node may be a class_definition or function_definition; look
  // up the decorated_definition wrapper.
  const parent = node.parent
  if (parent?.type !== 'decorated_definition') return false
  for (const child of parent.children) {
    if (child.type !== 'decorator') continue
    const name = getDecoratorName(child)
    if (DATA_CONTAINER_DECORATORS.has(name)) return true
  }
  return false
}

function hasOverrideDecorator(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'decorated_definition') return false
  for (const child of parent.children) {
    if (child.type !== 'decorator') continue
    const name = getDecoratorName(child)
    if (OVERRIDE_DECORATORS.has(name)) return true
  }
  return false
}

function isExceptionClass(cls: SyntaxNode): boolean {
  const names = getClassBaseNames(cls)
  return names.some((n) => n === 'Exception' || n === 'BaseException' || /Error$/.test(n) || /Exception$/.test(n))
}

function classBodyIsAllAbstractStubs(cls: SyntaxNode): boolean {
  const body = cls.childForFieldName('body')
  if (!body) return false
  let sawMethod = false
  for (const stmt of body.namedChildren) {
    if (stmt.type === 'expression_statement') {
      // docstring or `...` ellipsis — fine
      const inner = stmt.namedChildren[0]
      if (inner?.type === 'string' || inner?.type === 'ellipsis') continue
      return false
    }
    if (stmt.type === 'pass_statement') continue
    if (stmt.type === 'function_definition' || stmt.type === 'decorated_definition') {
      sawMethod = true
      // Check the inner function for @abstractmethod / @abstractproperty
      const fn = stmt.type === 'decorated_definition'
        ? stmt.namedChildren.find((c) => c.type === 'function_definition' || c.type === 'async_function_definition')
        : stmt
      if (!fn) return false
      const fnBody = fn.childForFieldName('body')
      if (!fnBody) return false
      // Function body must be `pass`, `...`, or a docstring + ellipsis.
      const onlyTrivial = fnBody.namedChildren.every((s) => {
        if (s.type === 'pass_statement') return true
        if (s.type === 'expression_statement') {
          const inner = s.namedChildren[0]
          return inner?.type === 'ellipsis' || inner?.type === 'string'
        }
        return false
      })
      if (!onlyTrivial) return false
      if (stmt.type === 'decorated_definition') {
        const hasAbstract = stmt.children.some((c) => {
          if (c.type !== 'decorator') return false
          const name = getDecoratorName(c)
          return name === 'abstractmethod' || name === 'abstractproperty'
        })
        if (!hasAbstract) return false
      }
      continue
    }
    return false
  }
  return sawMethod
}

function classBodyIsPassOrEllipsis(cls: SyntaxNode): boolean {
  const body = cls.childForFieldName('body')
  if (!body) return false
  for (const stmt of body.namedChildren) {
    if (stmt.type === 'pass_statement') continue
    if (stmt.type === 'expression_statement') {
      const inner = stmt.namedChildren[0]
      if (inner?.type === 'ellipsis' || inner?.type === 'string') continue
    }
    return false
  }
  return true
}

function classBodyIsOnlyAttributes(cls: SyntaxNode): boolean {
  // True if the class body is just type-annotated assignments
  // / plain assignments / docstring / ellipsis / pass — no
  // methods. Used for Pydantic / dataclass / TypedDict /
  // NamedTuple data containers.
  const body = cls.childForFieldName('body')
  if (!body) return false
  for (const stmt of body.namedChildren) {
    if (stmt.type === 'pass_statement') continue
    if (stmt.type === 'expression_statement') {
      const inner = stmt.namedChildren[0]
      if (inner?.type === 'string' || inner?.type === 'ellipsis') continue
      return false
    }
    if (stmt.type === 'expression_statement') continue
    if (stmt.type === 'assignment' || stmt.type === 'augmented_assignment') continue
    // Type-annotated: `x: int = 0` is wrapped as expression_statement → assignment
    return false
  }
  return true
}

function classHasNonTrivialBase(cls: SyntaxNode): boolean {
  const names = getClassBaseNames(cls)
  return names.length > 0 && names.some((n) => n !== 'object')
}

function isNestedInsideFunction(node: SyntaxNode): boolean {
  // Walk up; if the nearest enclosing scope is a function (not a
  // class or module), this is a nested helper.
  let cursor: SyntaxNode | null = node.parent
  while (cursor) {
    if (cursor.type === 'function_definition' || cursor.type === 'async_function_definition') return true
    if (cursor.type === 'class_definition' || cursor.type === 'module') return false
    cursor = cursor.parent
  }
  return false
}

function functionBodyIsTrivial(fn: SyntaxNode): boolean {
  // Single return / pass / ellipsis / single expression call —
  // no branching, no loops. Common for DI factories, getters,
  // and predicate helpers.
  const body = fn.childForFieldName('body')
  if (!body) return false
  const stmts = body.namedChildren.filter((c) => c.type !== 'comment')
  if (stmts.length === 0) return false
  // Allow a single docstring + a single trivial body statement.
  let i = 0
  if (stmts[0].type === 'expression_statement' && stmts[0].namedChildren[0]?.type === 'string') {
    i = 1
  }
  if (stmts.length - i !== 1) return false
  const only = stmts[i]
  if (only.type === 'pass_statement') return true
  if (only.type === 'return_statement') return true
  if (only.type === 'expression_statement') {
    const inner = only.namedChildren[0]
    if (inner?.type === 'ellipsis' || inner?.type === 'call') return true
  }
  return false
}

function isOverrideMethod(fn: SyntaxNode): boolean {
  // Decorator-driven override / contract markers.
  if (hasOverrideDecorator(fn)) return true
  // Method on a class whose base is a known data-container /
  // framework base (logging.Filter, BaseModel, ABC, etc.). The
  // method is implementing the framework contract; the
  // framework's own docs cover semantics. Doesn't apply to
  // arbitrary user classes — just framework subclasses we can
  // identify by base name.
  const parent = fn.parent
  let blockNode: SyntaxNode | null = null
  if (parent?.type === 'block') blockNode = parent
  else if (parent?.type === 'decorated_definition' && parent.parent?.type === 'block') blockNode = parent.parent
  if (!blockNode) return false
  const cls = blockNode.parent
  if (cls?.type !== 'class_definition') return false
  return classExtendsDataContainer(cls)
}

export const pythonDocstringCompletenessVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/docstring-completeness',
  languages: ['python'],
  nodeTypes: ['function_definition', 'class_definition'],
  visit(node, filePath, sourceCode) {
    // Alembic / Django migration files — schema migrations
    // encode their purpose in the filename and file-level
    // docstring; per-function docstrings on `upgrade()`/
    // `downgrade()` aren't conventional.
    if (MIGRATION_PATH_RE.test(filePath)) return null

    const name = node.childForFieldName('name')
    if (!name) return null

    if (name.text.startsWith('_')) return null

    const parent = node.parent
    if (!parent) return null
    // Allow the node's parent to be `decorated_definition`; we
    // walk past that wrapper for the module/block check.
    const effectiveParent = parent.type === 'decorated_definition' ? parent.parent : parent
    if (effectiveParent?.type !== 'module' && effectiveParent?.type !== 'block') return null

    if (node.type === 'class_definition') {
      // Data-container classes (Pydantic / SQLModel / TypedDict
      // / NamedTuple / Enum / @dataclass / Protocol / ABC) —
      // fields are self-documenting and the framework owns the
      // contract.
      if (classExtendsDataContainer(node)) return null
      if (hasDataContainerDecorator(node)) return null

      // Exception classes — the name encodes the meaning.
      if (isExceptionClass(node)) return null

      // Abstract base whose body is only @abstractmethod stubs.
      if (classBodyIsAllAbstractStubs(node)) return null

      // Class body is just `pass` / `...` / docstring — nothing
      // to document beyond the placeholder.
      if (classBodyIsPassOrEllipsis(node)) return null

      // Class with no methods, only field declarations — same
      // rationale as data-container.
      if (classBodyIsOnlyAttributes(node)) return null

      // Nested classes inside a function — local helpers, not
      // public API surface.
      if (isNestedInsideFunction(node)) return null
    }

    if (node.type === 'function_definition') {
      // Override / abstract / contract methods — parent class
      // carries the docstring.
      if (isOverrideMethod(node)) return null

      // Nested functions inside another function — local
      // helpers, not public API surface.
      if (isNestedInsideFunction(node)) return null
    }

    const body = node.childForFieldName('body')
    if (!body) return null

    const firstStmt = body.namedChildren[0]
    if (!firstStmt) return null

    const isDocstring =
      firstStmt.type === 'expression_statement' &&
      firstStmt.namedChildren[0]?.type === 'string'

    if (!isDocstring) {
      const kind = node.type === 'class_definition' ? 'Class' : 'Function'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        `${kind} missing docstring`,
        `Public ${kind.toLowerCase()} '${name.text}' has no docstring.`,
        sourceCode,
        `Add a docstring: def ${name.text}(...):\n    """Description."""`,
      )
    }

    return null
  },
}
