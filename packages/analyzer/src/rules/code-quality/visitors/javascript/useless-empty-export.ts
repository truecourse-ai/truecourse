import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detect a redundant `export {}` statement.
 *
 * `export {}` is a TypeScript idiom that forces a file to be treated as an
 * ES module rather than a global script. It is only redundant when the file
 * is already unambiguously a module via other means — i.e. it has at least
 * one other real import/export AND does not depend on module scoping for
 * correctness (no `declare global`/`declare module`, no top-level
 * side-effect code that would leak to the global scope as a script).
 *
 * To avoid false positives, the visitor only fires when ALL of the
 * following are true on the containing program:
 *   - At least one other top-level import or export (non-empty) exists.
 *   - No `ambient_declaration` (`declare global { ... }`, `declare module ...`)
 *     is present.
 *   - No top-level statement other than imports/exports/type-only
 *     declarations is present (such statements imply side-effect code that
 *     relies on module scoping — polyfills, IIFEs, etc.).
 */
export const uselessEmptyExportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-empty-export',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    if (!isEmptyExportClause(node)) return null

    const program = getProgramRoot(node)
    if (!program) return null

    let hasOtherExportOrImport = false
    let hasAmbientDeclaration = false
    let hasSideEffectStatement = false

    for (const child of program.namedChildren) {
      if (!child) continue
      if (child.id === node.id) continue

      // `declare global { ... }` / `declare module '...' { ... }` —
      // requires module context to behave as augmentation; do not flag.
      if (child.type === 'ambient_declaration') {
        hasAmbientDeclaration = true
        continue
      }

      if (child.type === 'import_statement' || child.type === 'import_alias') {
        hasOtherExportOrImport = true
        continue
      }

      if (child.type === 'export_statement') {
        // Another `export {}` doesn't help disambiguate — only real exports count.
        if (!isEmptyExportClause(child)) {
          hasOtherExportOrImport = true
        }
        continue
      }

      // Type-only / declaration nodes don't emit runtime code and don't
      // require module scoping by themselves.
      if (
        child.type === 'interface_declaration' ||
        child.type === 'type_alias_declaration' ||
        child.type === 'comment' ||
        child.type === 'empty_statement'
      ) {
        continue
      }

      // Any other top-level statement (lexical_declaration, if_statement,
      // expression_statement, function_declaration without export, etc.)
      // represents side-effect or script-level code that benefits from
      // module scoping. Do not flag.
      hasSideEffectStatement = true
    }

    if (!hasOtherExportOrImport) return null
    if (hasAmbientDeclaration) return null
    if (hasSideEffectStatement) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Useless empty export',
      '`export {}` does nothing useful. Remove it unless it is needed to mark the file as a module.',
      sourceCode,
      'Remove the empty `export {}` statement.',
    )
  },
}

function isEmptyExportClause(node: SyntaxNode): boolean {
  const exportClause = node.namedChildren.find(
    (c): c is SyntaxNode => !!c && (c.type === 'named_exports' || c.type === 'export_clause'),
  )
  if (!exportClause) return false
  return exportClause.namedChildCount === 0
}

function getProgramRoot(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'program') return current
    current = current.parent
  }
  return null
}
