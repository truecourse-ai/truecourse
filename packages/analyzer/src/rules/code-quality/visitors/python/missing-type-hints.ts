import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonDecoratorName } from '../../../_shared/python-helpers.js'

type SyntaxNode = import('web-tree-sitter').Node

/**
 * True if `node` is a `function_definition` defined inside another
 * function's body (nested closure / helper). The closure captures
 * its outer scope's locals — type information already exists in
 * the enclosing function's signature, so explicit annotations on
 * the closure are mostly redundant noise.
 *
 * Walks up the parent chain, ignoring `decorated_definition`,
 * `block`, and conditional/with/try wrappers, until it hits a
 * `function_definition` (closure) or `class_definition` (method).
 */
function isNestedClosure(node: SyntaxNode): boolean {
  let cursor: SyntaxNode | null = node.parent
  while (cursor) {
    if (cursor.type === 'function_definition') return true
    if (cursor.type === 'class_definition') return false
    cursor = cursor.parent
  }
  return false
}

/**
 * Pydantic / dataclass-style validator decorators. The framework
 * convention is `(cls, v)` — `v` is the field value whose type is
 * declared on the field, not on the parameter. Explicit
 * annotation on `v` is rarely written and adds no information.
 */
const PYDANTIC_VALIDATOR_DECORATORS = new Set([
  'validator', 'field_validator', 'model_validator',
  'root_validator', 'serializer', 'field_serializer',
  'model_serializer', 'computed_field',
])

/**
 * True if the function (or its decorated wrapper) has a Pydantic
 * validator / serializer decorator.
 */
function hasPydanticValidatorDecorator(funcNode: SyntaxNode): boolean {
  const parent = funcNode.parent
  if (!parent || parent.type !== 'decorated_definition') return false
  for (const child of parent.children) {
    if (child.type !== 'decorator') continue
    const name = getPythonDecoratorName(child)
    if (name && PYDANTIC_VALIDATOR_DECORATORS.has(name)) return true
  }
  return false
}

/**
 * True if the file path looks like a CLI / script entry point —
 * basename is `__main__.py` / `manage.py`, OR an ancestor
 * directory name is `scripts`, `bin`, `tools`, `cli`, `cmd`.
 *
 * Tighter than the general `isScriptLikeFile` check: this only
 * uses path conventions, not "top-level imperative code in
 * module body". Worker modules like `data_pipeline.py` that
 * happen to have top-level setup are NOT considered scripts —
 * type hints there still help downstream callers.
 */
function isCliScriptByPath(filePath: string): boolean {
  const segments = filePath.split('/')
  const fileName = segments[segments.length - 1]?.toLowerCase() ?? ''
  if (fileName === '__main__.py' || fileName === 'manage.py') return true

  const SCRIPT_DIRS = new Set(['scripts', 'bin', 'tools', 'cli', 'cmd'])
  for (let i = 1; i < segments.length - 1; i++) {
    if (SCRIPT_DIRS.has(segments[i].toLowerCase())) return true
  }
  return false
}

function isPublicFunction(node: SyntaxNode): boolean {
  const name = node.childForFieldName('name')?.text ?? ''
  // Only check public functions (not starting with _)
  // Skip __init__ and dunder methods
  return !name.startsWith('_')
}

function paramHasType(param: SyntaxNode): boolean {
  // typed_parameter has an explicit type annotation
  return param.type === 'typed_parameter' || param.type === 'typed_default_parameter'
}

function hasReturnType(node: SyntaxNode): boolean {
  // Return type annotation: def foo() -> Type:
  return node.childForFieldName('return_type') !== null
}

export const pythonMissingTypeHintsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-type-hints',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    if (!isPublicFunction(node)) return null

    // CLI / script entry-point files (`__main__.py`, `manage.py`,
    // anything inside `scripts/` / `bin/` / `tools/` / `cli/` /
    // `cmd/`). Type hints there add little value — the code is the
    // entry point, not an API surface for callers.
    if (isCliScriptByPath(filePath)) return null

    // Nested closures / inner helper functions inherit type
    // context from the enclosing function — annotations are
    // mostly redundant.
    if (isNestedClosure(node)) return null

    // Pydantic / Marshmallow validators & serializers — the
    // `(cls, v)` convention deliberately leaves `v` untyped
    // because the field's declared type is the source of truth.
    if (hasPydanticValidatorDecorator(node)) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? 'function'

    const paramList = params.namedChildren.filter((p) =>
      p.type === 'identifier' ||
      p.type === 'typed_parameter' ||
      p.type === 'default_parameter' ||
      p.type === 'typed_default_parameter',
    )

    // Skip if function only has self parameter
    const nonSelfParams = paramList.filter((p) => {
      const pName = p.type === 'identifier' ? p.text : p.namedChildren[0]?.text
      return pName !== 'self' && pName !== 'cls'
    })

    // Count parameters missing type hints
    const untypedParams = nonSelfParams.filter((p) => !paramHasType(p))
    const missingReturn = !hasReturnType(node)

    if (untypedParams.length === 0 && !missingReturn) return null

    const issues: string[] = []
    if (untypedParams.length > 0) {
      const names = untypedParams.map((p) =>
        p.type === 'identifier' ? p.text : p.namedChildren[0]?.text ?? '?',
      )
      issues.push(`parameters without type hints: ${names.map((n) => `\`${n}\``).join(', ')}`)
    }
    if (missingReturn) issues.push('missing return type annotation')

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Missing type hints',
      `Function \`${name}\` has ${issues.join(' and ')}. Type hints improve IDE support, documentation, and catch errors early.`,
      sourceCode,
      'Add type annotations to all parameters and the return type.',
    )
  },
}
