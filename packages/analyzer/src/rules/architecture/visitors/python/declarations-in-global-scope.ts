import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Schema-migration directories: Alembic / Django / generic migration files
// are essentially top-down scripts whose canonical structure includes
// module-level metadata (revision, down_revision, branch_labels,
// depends_on) and mutable bookkeeping. The rule is moot here.
const MIGRATION_PATH_RE = /(?:[\\/]|^)(?:alembic|migrations)[\\/]versions[\\/]/i

// Names from `typing` (and built-in generic equivalents) that mark a
// `subscript` as a type-alias construction, not a runtime mutable.
const TYPING_NAMES = new Set([
  'Callable', 'Optional', 'Union', 'Literal', 'Annotated', 'Final',
  'List', 'Tuple', 'Dict', 'Set', 'FrozenSet', 'Type', 'ClassVar',
  'Sequence', 'Mapping', 'MutableMapping', 'Iterable', 'Iterator',
  'Generator', 'Coroutine', 'Awaitable', 'AsyncIterable', 'AsyncIterator',
  'Protocol', 'TypedDict', 'NamedTuple',
  // Built-in generics (PEP 585)
  'list', 'tuple', 'dict', 'set', 'frozenset', 'type',
])

function isTypingConstruct(node: SyntaxNode): boolean {
  if (node.type !== 'subscript') return false
  const value = node.childForFieldName('value')
  if (!value) return false
  if (value.type === 'identifier') return TYPING_NAMES.has(value.text)
  // typing.Callable / t.Optional → check the trailing attribute
  if (value.type === 'attribute') {
    const attr = value.childForFieldName('attribute')
    if (attr && TYPING_NAMES.has(attr.text)) return true
  }
  return false
}

/** Walk attribute chain to check if the root is a call (e.g., Path(...).parent.parent). */
function rootIsCall(node: SyntaxNode): boolean {
  if (node.type === 'call') return true
  if (node.type === 'attribute') {
    const obj = node.childForFieldName('object')
    if (obj) return rootIsCall(obj)
  }
  if (node.type === 'subscript') {
    const val = node.childForFieldName('value')
    if (val) return rootIsCall(val)
  }
  return false
}

export const pythonDeclarationsInGlobalScopeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/declarations-in-global-scope',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    if (MIGRATION_PATH_RE.test(filePath)) return null

    // tree-sitter wraps assignments in expression_statement, so check both:
    // assignment → module  OR  assignment → expression_statement → module
    const parent = node.parent
    const isModuleLevel =
      parent?.type === 'module' ||
      (parent?.type === 'expression_statement' && parent.parent?.type === 'module')
    if (!isModuleLevel) return null

    const left = node.childForFieldName('left')
    if (!left) return null

    const name = left.text

    // Skip UPPER_CASE constants (intentional module-level constants)
    if (/^[A-Z_][A-Z_0-9]*$/.test(name)) return null

    // Skip __dunder__ variables
    if (name.startsWith('__') && name.endsWith('__')) return null

    // Skip _ private/unused variables
    if (name.startsWith('_')) return null

    // Skip common module-level singleton patterns in Python
    const COMMON_MODULE_VARS = new Set([
      'logger', 'log', 'app', 'api', 'router', 'blueprint',
      'db', 'engine', 'session', 'connection', 'conn', 'pool',
      'client', 'redis', 'cache', 'celery', 'sio',
      'templates', 'jinja', 'env',
      'settings', 'config', 'configuration',
      'schema', 'serializer', 'parser',
      'manager', 'registry', 'factory',
    ])
    if (COMMON_MODULE_VARS.has(name)) return null

    // Skip variables with common suffixes for singleton instances
    if (/_(client|router|app|config|settings|pool|engine|factory|registry|manager|service|handler|middleware|plugin)$/.test(name)) return null

    // Skip annotated assignments — `x: str = value` at module level is
    // typically a typed config declaration, not dangerous mutable state.
    if (node.childForFieldName('type')) return null

    // Skip RHS that is a function/constructor call or attribute chain from
    // a call — module-level initialization like `redis_client = Redis()` or
    // `project_root = Path(__file__).parent.parent` is standard Python.
    const right = node.childForFieldName('right')
    if (right?.type === 'call') return null
    if (right?.type === 'attribute' && rootIsCall(right)) return null

    // Skip type aliases — `RetryHook = Callable[..., None]`, `Status =
    // Literal["a", "b"]`, `Pair = tuple[int, str]`. These are immutable
    // typing declarations, not mutable shared state. Detect by RHS
    // shape: a `subscript` whose value is a typing construct.
    if (right?.type === 'subscript' && isTypingConstruct(right)) return null

    // PEP 604 type aliases: `GithubViewType = GithubIssueView | GithubPRView`
    // — tree-sitter parses these as `binary_operator` with `|`. The whole
    // expression is a type expression, not mutable state.
    if (right?.type === 'binary_operator') {
      const op = right.children.find((c) => c.text === '|')
      if (op) return null
    }
    // Module-level `Any` aliases / direct typing references:
    //   `User = UserGitInfo`  (backward-compat alias)
    //   `Status = Any`        (relax helper)
    // RHS is a bare identifier that's PascalCase or matches a typing
    // primitive. Treat as type alias.
    if (right?.type === 'identifier') {
      if (/^[A-Z]/.test(right.text)) return null
      if (TYPING_NAMES.has(right.text)) return null
    }

    // Multi-line query / template / SQL string constants. Module-level
    // `xxx_query = """..."""` / `xxx_template = "..."` / `xxx_sql`,
    // `xxx_pattern`, `xxx_html`, `xxx_xml` are immutable text resources
    // by convention even when the variable name is lowercase. The rule's
    // mutable-state concern doesn't apply.
    if (right?.type === 'string') {
      if (/_(?:query|template|sql|pattern|regex|html|xml|css|prompt|message)s?$/.test(name)) return null
    }
    // Concatenated strings with same suffix
    if (right?.type === 'concatenated_string') {
      if (/_(?:query|template|sql|pattern|regex|html|xml|css|prompt|message)s?$/.test(name)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Mutable variable in global scope',
      `Module-level mutable variable '${name}' creates shared state that is hard to test.`,
      sourceCode,
      'Move into a function, class, or use UPPER_CASE for intended constants.',
    )
  },
}
