import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

// Method names whose first string argument is a property/key
// access. The string IS the schema field name, not a refactor
// candidate.
const DICT_ACCESSOR_METHODS = new Set([
  'get', 'pop', 'setdefault', 'getlist', 'getall',
])

/**
 * True if the string literal is being used as a dict-key access:
 * `obj['key']` (subscript index) or `obj.get('key', default)`
 * (accessor call). Repeating an API field name across a parser
 * is structural, not a code smell — extracting it to a constant
 * adds indirection without benefit.
 */
function isDictKeyAccess(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false

  // `obj['key']` — string is the slice / subscript index
  if (parent.type === 'subscript') {
    const subscript = parent.childForFieldName('subscript')
    if (subscript?.id === node.id) return true
  }

  // `obj.get('key', …)` — string is first argument to a known
  // dict-access method.
  if (parent.type === 'argument_list') {
    const call = parent.parent
    if (call?.type === 'call') {
      const fn = call.childForFieldName('function')
      if (fn?.type === 'attribute') {
        const method = fn.childForFieldName('attribute')
        if (method && DICT_ACCESSOR_METHODS.has(method.text)) {
          // Only the FIRST argument is the key — defaults follow.
          if (parent.namedChildren[0]?.id === node.id) return true
        }
      }
    }
  }

  return false
}

/**
 * True if the string is the KEY of a dict pair —
 * `{'slug': slug, 'name': name}`. Same rationale as dict-key
 * access: the string is the field name, not a magic value.
 */
function isDictPairKey(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'pair') return false
  const keyNode = parent.childForFieldName('key')
  return keyNode?.id === node.id
}

/**
 * True if the string is the right-hand side of a `key in obj`
 * membership test or `obj.<membership>('key')` call where the
 * string is again a field name. Covers `'foo' in payload`.
 */
function isMembershipTestKey(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'comparison_operator') return false
  // tree-sitter Python emits `comparison_operator` with operator
  // children. We check the LEFT-side string only when operator is `in`.
  for (let i = 0; i < parent.childCount; i++) {
    const c = parent.child(i)
    if (c && (c.type === 'in' || c.text === 'in')) {
      // The string at the LEFT of the `in` is the key being tested.
      const leftIdx = parent.namedChildren.findIndex((nc) => nc.id === node.id)
      if (leftIdx === 0) return true
    }
  }
  return false
}

// Function names whose string argument is a SQL/schema/regex/etc.
// fragment that's structurally bound to the surrounding code,
// not a refactor candidate. Repeating `text('CURRENT_TIMESTAMP')`
// across `server_default` / `onupdate` is canonical SQLAlchemy.
const STRUCTURAL_STRING_CALLEES = new Set([
  // SQLAlchemy
  'text', 'literal', 'literal_column', 'column', 'table',
  'relationship', 'foreign_key', 'ForeignKey', 'CheckConstraint',
  'Index', 'UniqueConstraint', 'PrimaryKeyConstraint',
  // Regex
  'compile', 'match', 'fullmatch', 'search', 'findall', 'finditer',
  'sub', 'subn', 'split',
])

/**
 * True if the string is the first argument to a function whose
 * name marks it as a structural / schema callee — `text(...)`,
 * `relationship(...)`, `re.compile(...)`. The string is bound to
 * the SQL/regex semantics, not refactorable.
 */
function isStructuralStringArg(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'argument_list') return false
  if (parent.namedChildren[0]?.id !== node.id) return false
  const call = parent.parent
  if (call?.type !== 'call') return false
  const fn = call.childForFieldName('function')
  if (!fn) return false
  let name = ''
  if (fn.type === 'identifier') name = fn.text
  else if (fn.type === 'attribute') name = fn.childForFieldName('attribute')?.text ?? ''
  return STRUCTURAL_STRING_CALLEES.has(name)
}

/**
 * True if the string is the value of a keyword argument whose
 * name marks it as schema / contract metadata: `back_populates=`,
 * `foreign_keys=`, `secondary=`, `__tablename__`,
 * `server_default=text('...')` (covered above), `onupdate=`,
 * `default=`, `description=`, `title=`. The keyword name binds
 * the string semantically.
 */
function isStructuralKwargValue(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'keyword_argument') return false
  if (parent.childForFieldName('value')?.id !== node.id) return false
  const name = parent.childForFieldName('name')
  const text = name?.text ?? ''
  return [
    'back_populates', 'foreign_keys', 'secondary',
    'server_default', 'onupdate', 'default',
    'description', 'title', 'help', 'doc', 'docstring',
    'mode', 'kind', 'type', 'role',
  ].includes(text)
}

/**
 * True if the string is `'true'` or `'false'` (case-insensitive)
 * and is being compared via `==` / `!=` to an env-var lookup
 * result. `os.getenv('X', 'false') == 'true'` is the canonical
 * env-flag pattern.
 */
function isEnvFlagComparison(node: SyntaxNode): boolean {
  const inner = node.text.replace(/^['"]|['"]$/g, '').toLowerCase()
  if (inner !== 'true' && inner !== 'false' && inner !== 'yes' && inner !== 'no' &&
      inner !== '1' && inner !== '0') return false
  const parent = node.parent
  if (parent?.type !== 'comparison_operator') return false
  for (const c of parent.children) {
    if (c.type === 'identifier' || c.type === 'attribute' || c.type === 'call') {
      // Other operand contains an env-flavored identifier.
      if (/(?:env|environ|getenv|getconf)/i.test(c.text)) return true
    }
  }
  return false
}

// Schema-migration directories: column / table name strings are
// inherently repeated across upgrade / downgrade and constraint
// declarations. Extracting to constants doesn't help and breaks
// the migration's self-contained convention.
const MIGRATION_PATH_RE = /(?:[\\/]|^)(?:alembic|migrations)[\\/]versions[\\/]/i

export const pythonDuplicateStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-string',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    if (MIGRATION_PATH_RE.test(filePath)) return null

    const stringCounts = new Map<string, { count: number; firstNode: SyntaxNode }>()

    function walk(n: SyntaxNode) {
      if (n.type === 'string') {
        const content = n.text
        if (content.length <= 3) return
        // Skip imports
        const parent = n.parent
        if (parent?.type === 'import_from_statement' || parent?.type === 'import_statement') return

        // Skip dict-key access: `payload['key']`, `payload.get('key')`.
        // The repetition is structural — the string IS the schema field
        // name and extracting it to a constant adds indirection without
        // benefit. ~30-40% of Python duplicate-string FPs are this shape.
        if (isDictKeyAccess(n)) return

        // Skip dict-pair keys: `{'slug': …, 'name': …}` — same rationale.
        if (isDictPairKey(n)) return

        // Skip membership test keys: `'k' in payload`.
        if (isMembershipTestKey(n)) return

        // Skip SQLAlchemy / regex / SQL structural callees:
        // `text('CURRENT_TIMESTAMP')`, `relationship('User')`,
        // `re.compile(r'...')`. The string is bound to the
        // schema / regex semantics.
        if (isStructuralStringArg(n)) return

        // Skip kwarg values for schema / contract metadata
        // (`back_populates='...'`, `description='...'`,
        // `default='...'`).
        if (isStructuralKwargValue(n)) return

        // Skip env-flag comparisons: `os.getenv('X', 'false') == 'true'`.
        if (isEnvFlagComparison(n)) return

        const existing = stringCounts.get(content)
        if (existing) {
          existing.count++
        } else {
          stringCounts.set(content, { count: 1, firstNode: n })
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (const [content, info] of stringCounts) {
      if (info.count >= 3) {
        return makeViolation(
          this.ruleKey, info.firstNode, filePath, 'low',
          'Duplicate string literal',
          `String ${content} appears ${info.count} times. Extract to a named constant.`,
          sourceCode,
          'Extract the repeated string into a constant variable.',
        )
      }
    }
    return null
  },
}
