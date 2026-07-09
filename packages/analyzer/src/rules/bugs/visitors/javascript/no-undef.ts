import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

/**
 * Detects references to variables that were never declared anywhere in scope.
 * Uses undeclaredReferences() which already filters out known globals.
 * Filters out assignment contexts (those are handled by implicit-global rule).
 *
 * Only fires in files with a module system (ES modules or CommonJS). A bare
 * browser `<script>` resolves free identifiers against the runtime global
 * object, which is populated by sibling script tags and vendor bundles the
 * analyzer can't see (jQuery's `$`, `bootstrap`, app namespaces like `abp`, …),
 * so there a "not defined" claim is unsound. A module — whether ESM (imports +
 * top-level declarations) or CommonJS (only `require`/`module`/`exports` and the
 * known Node globals are injected) — has a closed binding set, so an unresolved
 * reference genuinely throws a ReferenceError, which is exactly what this rule
 * promises.
 */
export const noUndefVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-undef',
  // Only applies to JavaScript — in TypeScript the compiler handles undeclared references
  // via ambient declarations and tsconfig, so static detection here would be too noisy.
  languages: ['javascript'],
  nodeTypes: ['program'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null
    if (!hasModuleScope(node)) return null
    const undeclared = dataFlow.undeclaredReferences()
    for (const ref of undeclared) {
      const parent = ref.node.parent
      if (!parent) continue

      // Skip assignment left-hand side (handled by implicit-global)
      const isAssignmentLeft =
        (parent.type === 'assignment_expression' || parent.type === 'augmented_assignment_expression') &&
        parent.childForFieldName('left')?.id === ref.node.id
      if (isAssignmentLeft) continue

      // Skip type positions (TypeScript type-only references)
      if (isTypePosition(ref.node)) continue

      return makeViolation(
        this.ruleKey,
        ref.node,
        filePath,
        'high',
        'Undeclared variable',
        `\`${ref.name}\` is not defined. This will throw a ReferenceError at runtime.`,
        sourceCode,
        'Declare the variable, import it, or add it to the global declarations if it is a runtime global.',
      )
    }
    return null
  },
}

/**
 * Whether the file has a module system — ES module (top-level `import`/`export`)
 * or CommonJS (`require(...)`, `module.exports`, `exports.x`). Only then is the
 * binding set closed and an unresolved free identifier a guaranteed
 * ReferenceError. A file with none of these is a bare browser script whose free
 * identifiers may come from sibling `<script>` tags, so the rule stays silent.
 *
 * `import()` expressions and `import.meta` don't count as ESM markers — those are
 * legal in classic scripts too — so ESM detection looks for statement-level
 * nodes only.
 */
function hasModuleScope(program: import('web-tree-sitter').Node): boolean {
  type Node = import('web-tree-sitter').Node
  // ESM: top-level import/export statement.
  for (let i = 0; i < program.childCount; i++) {
    const child = program.child(i)
    if (!child) continue
    if (child.type === 'import_statement' || child.type === 'export_statement') return true
  }
  // CommonJS: a `require(...)` call or a `module`/`exports` member access anywhere.
  let found = false
  function walk(n: Node) {
    if (found) return
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      if (fn?.type === 'identifier' && fn.text === 'require') { found = true; return }
    }
    if (n.type === 'member_expression') {
      const obj = n.childForFieldName('object')
      if (obj?.type === 'identifier' && (obj.text === 'module' || obj.text === 'exports')) { found = true; return }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(program)
  return found
}

function isTypePosition(node: import('web-tree-sitter').Node): boolean {
  let current = node.parent
  while (current) {
    if (
      current.type === 'type_annotation' ||
      current.type === 'type_alias_declaration' ||
      current.type === 'interface_declaration' ||
      current.type === 'type_parameter' ||
      current.type === 'type_arguments' ||
      current.type === 'generic_type' ||
      current.type === 'constraint' ||
      current.type === 'implements_clause' ||
      current.type === 'extends_clause' ||
      current.type === 'predefined_type'
    ) return true
    current = current.parent
  }
  return false
}
