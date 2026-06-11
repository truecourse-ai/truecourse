import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * LINQ `…OrDefault()` result dereferenced without a null check — the C# analog
 * of `.find()` deref. Scoped to the *OrDefault family because the naming
 * convention guarantees a possibly-default return; `Find` is deliberately
 * excluded (MongoDB's `collection.Find(...)` returns a never-null fluent
 * cursor and EF's `DbSet.Find` can't be told apart without type info).
 *
 * Known recall/precision limits (no type checker):
 *   - sequences of value types return default(T), not null — dereferencing is
 *     safe but indistinguishable. The struct-leaning member accesses are
 *     skipped: `.Key` / `.Value` (KeyValuePair), `.HasValue` /
 *     `.GetValueOrDefault()` (Nullable<T>), and the universal object members
 *     (`.ToString()` / `.CompareTo()` / `.Equals()` / `.GetHashCode()`) that
 *     numeric `…OrDefault()` results are routinely fed into. Real null-deref
 *     bugs overwhelmingly access domain members, which still fire;
 *   - the .NET 6+ overloads taking an explicit default value are skipped.
 */
const OR_DEFAULT_METHODS = new Set([
  'FirstOrDefault', 'SingleOrDefault', 'LastOrDefault', 'ElementAtOrDefault',
])

const STRUCT_SAFE_MEMBERS = new Set([
  'Key', 'Value', 'HasValue', 'GetValueOrDefault',
  'ToString', 'CompareTo', 'Equals', 'GetHashCode',
])

export const csharpMissingNullCheckAfterFindVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-null-check-after-find',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!OR_DEFAULT_METHODS.has(method)) return null

    // Overloads with an explicit default value (`FirstOrDefault(x => …, fallback)`
    // / `FirstOrDefault(fallback)`) — the author supplied the fallback.
    const args = getCSharpArguments(node)
    if (args.length >= 2) return null
    if (args.length === 1 && args[0]!.type !== 'lambda_expression') return null

    const parent = node.parent
    if (!parent) return null

    // `…OrDefault()?.Member` — already null-safe.
    if (parent.type === 'conditional_access_expression') return null
    // `…OrDefault()!` — explicit null-forgiving assertion by the author.
    if (parent.type === 'postfix_unary_expression') return null

    // Immediate dereference: `…OrDefault().Member` / `…OrDefault().Method()`.
    if (
      parent.type === 'member_access_expression' &&
      parent.childForFieldName('expression')?.id === node.id
    ) {
      const memberName = parent.childForFieldName('name')?.text ?? ''
      if (STRUCT_SAFE_MEMBERS.has(memberName)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `Missing null check after ${method}()`,
        `${method}() returns null when no element matches. Dereferencing the result directly throws NullReferenceException.`,
        sourceCode,
        `Use ?. (null-conditional), check the result against null first, or use ${method.replace('OrDefault', '')}() if absence is a bug.`,
      )
    }

    return null
  },
}
