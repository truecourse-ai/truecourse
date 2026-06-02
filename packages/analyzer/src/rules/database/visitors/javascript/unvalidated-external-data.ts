import type { CodeRuleVisitor } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, ORM_WRITE_METHODS, SQL_WRITE_METHODS } from './_helpers.js'
import { findUserInputAccess } from '../../../_shared/javascript-helpers.js'

// Method names heavily overloaded by built-in JS / Node APIs - `Set.add`,
// `Map.delete`, `Hash.update` (crypto), `AsyncLocalStorage.run`, generic
// task `.run()` helpers. ORM frameworks happen to use the same words,
// but firing on every `.update()` / `.run()` produces ~100% FPs on
// non-DB code. Require an ORM-shaped receiver for these specific
// methods. `create` / `save` / `upsert` / `destroy` / `*Many` stay
// unrestricted because they're rarely used as JS collection / crypto
// / async-context method names.
const AMBIGUOUS_ORM_METHODS = new Set(['add', 'delete', 'update', 'run'])
const ORM_RECEIVER_NAMES = new Set([
  'session', 'db', 'conn', 'connection', 'cursor', 'engine', 'database',
  'manager', 'repo', 'repository', 'orm', 'em', 'tx', 'trx', 'knex',
  'prisma', 'sequelize', 'mongoose',
])

function hasOrmLikeReceiver(node: import('web-tree-sitter').Node): boolean {
  const fn = node.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  // Walk through the member chain (`this.prisma.user.update`,
  // `db.users.update`, etc.) and accept if any segment — root identifier
  // or intermediate property — names a known ORM receiver. This catches
  // method-style receivers (`this.prisma.…`, `ctx.db.…`) where the root
  // is `this`/`ctx`, not a bare ORM identifier.
  let cur: import('web-tree-sitter').Node | null = fn.childForFieldName('object')
  while (cur) {
    if (cur.type === 'member_expression') {
      const prop = cur.childForFieldName('property')
      if (prop?.type === 'property_identifier' && ORM_RECEIVER_NAMES.has(prop.text.toLowerCase())) return true
      cur = cur.childForFieldName('object')
      continue
    }
    if (cur.type === 'identifier') {
      return ORM_RECEIVER_NAMES.has(cur.text.toLowerCase())
    }
    return false
  }
  return false
}

export const unvalidatedExternalDataVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unvalidated-external-data',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    const methodName = getMethodName(node)
    if (!ORM_WRITE_METHODS.has(methodName) && !SQL_WRITE_METHODS.has(methodName)) return null

    // Ambiguous method names (`add`, `update`, etc.) overlap with Set /
    // Map / array semantics. Require the receiver to look ORM-shaped to
    // avoid firing on `state.expandedVendors.add(vendor)` and similar
    // client-side state updates.
    if (AMBIGUOUS_ORM_METHODS.has(methodName) && !hasOrmLikeReceiver(node)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Real AST + scope-aware external-data detection. See _shared/javascript-helpers.ts.
    // Replaces the previous identifier-name check that flagged any local variable
    // named `body` / `payload` / `data` as external — a massive FP source on
    // codebases that use those names for non-request data (cache reads,
    // computed values, internal events).
    for (const arg of args.namedChildren) {
      // A value written to the DB is "unvalidated external data" only when it
      // IS the raw request payload — not when it's a server-derived value
      // returned from a helper that merely *received* request data (e.g. an
      // authenticated entity from `resolveAccount({ token: req.headers... })`).
      // `stopTaintAtCallReturns` keeps direct request reads and `req.json()`
      // destructures flagged while dropping taint carried only through a
      // helper's arguments.
      if (findUserInputAccess(arg, dataFlow, { stopTaintAtCallReturns: true })) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unvalidated external data used in database write',
          `External data (e.g., \`req.body\`, \`request.params\`) passed directly to \`${methodName}()\` without schema validation. Validate input with a schema library (e.g., \`zod\`, \`joi\`) before writing to the database.`,
          sourceCode,
          'Parse and validate external data with a schema library before using it in database operations.',
        )
      }
    }

    return null
  },
}
