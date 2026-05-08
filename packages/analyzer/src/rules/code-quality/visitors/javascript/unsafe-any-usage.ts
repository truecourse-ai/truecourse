import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Using a value typed as `any` in assignments, calls, returns, or member access.
 * Corresponds to @typescript-eslint no-unsafe-argument, no-unsafe-assignment,
 * no-unsafe-call, no-unsafe-member-access, no-unsafe-return.
 */

// True when the identifier `name` has an EXPLICIT `any`-type origin
// somewhere in this file: declared `: any`, cast `as any`, or assigned
// from a known any-returning built-in (`JSON.parse`, `eval`, `Function`).
//
// In monorepos, when the analyzer's scoped TS program can't resolve a
// type across package boundaries (Prisma client, Kysely chains, Next.js
// typed routes), TS's getTypeAtLocation returns `any` even though the
// developer's IDE reports the concrete type. Without this gate, those
// resolution failures produced ~75% FPs (8,700+ on documenso). When
// the file source carries no explicit-any marker for the name, the
// `any` is presumed a resolution fallback and the rule skips.
function hasExplicitAnyOrigin(name: string, sourceCode: string): boolean {
  if (!name || /[^A-Za-z_$0-9]/.test(name)) return false
  // const/let/var <name>: any = ...
  if (new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*:\\s*any\\b`).test(sourceCode)) return true
  // (<name>: any) — function/arrow/method parameter annotation
  if (new RegExp(`[(,]\\s*${name}\\s*:\\s*any\\b`).test(sourceCode)) return true
  // `<name> as any` — cast applied directly to the identifier.
  // Must be the IDENTIFIER itself being cast, not any expression
  // containing it. `fn(...) as any` does NOT count — the cast is
  // on the call result, the identifier `fn` retains its real
  // type. (Without this restriction, Kysely / Prisma fluent
  // chains that legitimately have one `as any` cast on a
  // sub-expression would flood the file with FPs on every use
  // of the chained variable.)
  if (new RegExp(`\\b${name}\\s+as\\s+any\\b`).test(sourceCode)) return true
  // <name> = JSON.parse(...) / eval(...) / new Function(...)
  if (new RegExp(`\\b${name}\\s*=\\s*(?:JSON\\.parse|eval|new\\s+Function)\\s*\\(`).test(sourceCode)) return true
  // const/let <name> = JSON.parse(...) / eval(...) / new Function(...)
  if (new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:JSON\\.parse|eval|new\\s+Function)\\s*\\(`).test(sourceCode)) return true
  return false
}

export const unsafeAnyUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unsafe-any-usage',
  languages: TS_LANGUAGES,
  nodeTypes: ['call_expression', 'member_expression', 'assignment_expression', 'variable_declarator'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    if (node.type === 'call_expression') {
      // Unsafe call: calling a value typed as any
      const fn = node.childForFieldName('function')
      if (fn && fn.type === 'identifier') {
        const isAny = typeQuery.isAnyType(filePath, fn.startPosition.row, fn.startPosition.column, fn.endPosition.row, fn.endPosition.column)
        if (isAny) {
          if (!hasExplicitAnyOrigin(fn.text, sourceCode)) return null
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Calling an `any` typed value',
            `\`${fn.text}\` is typed as \`any\` — calling it bypasses all type checking.`,
            sourceCode,
            'Add a proper type annotation or use `unknown` with type guards.',
          )
        }
      }
    }

    if (node.type === 'member_expression') {
      // Unsafe member access: accessing property on any
      const obj = node.childForFieldName('object')
      if (obj && obj.type === 'identifier') {
        const isAny = typeQuery.isAnyType(filePath, obj.startPosition.row, obj.startPosition.column, obj.endPosition.row, obj.endPosition.column)
        if (isAny) {
          if (!hasExplicitAnyOrigin(obj.text, sourceCode)) return null
          const prop = node.childForFieldName('property')
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Unsafe member access on `any`',
            `Accessing \`.${prop?.text ?? '?'}\` on \`${obj.text}\` which is typed as \`any\` — no type safety.`,
            sourceCode,
            'Add a proper type annotation to the object or use type guards.',
          )
        }
      }
    }

    if (node.type === 'variable_declarator') {
      // Unsafe assignment: assigning any to a typed variable
      const value = node.childForFieldName('value')
      if (!value) return null
      const isAny = typeQuery.isAnyType(filePath, value.startPosition.row, value.startPosition.column, value.endPosition.row, value.endPosition.column)
      if (isAny && value.type !== 'identifier') {
        // Only flag non-trivial any assignments (e.g., function calls returning any)
        if (value.type === 'call_expression') {
          const nameNode = node.childForFieldName('name')
          // Skip when this assignment isn't from a known any-source.
          // The call's callee (e.g., `JSON.parse`, `findDocuments`)
          // determines whether the result is genuinely `any` (built-in
          // any-returner) or just unresolved cross-package type. Use
          // the same heuristic as the call/member-access cases —
          // require an explicit-any signal in the file source.
          const callee = value.childForFieldName('function')?.text ?? ''
          if (!/^(?:JSON\.parse|eval)$/.test(callee) && !/\bas\s+any\b/.test(value.text) &&
              (!nameNode || !hasExplicitAnyOrigin(nameNode.text, sourceCode))) {
            return null
          }
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Assigning `any` value',
            `\`${nameNode?.text ?? 'variable'}\` receives a value typed as \`any\` — type safety is lost.`,
            sourceCode,
            'Add type annotations to the function return type or use type assertions with caution.',
          )
        }
      }
    }

    return null
  },
}
