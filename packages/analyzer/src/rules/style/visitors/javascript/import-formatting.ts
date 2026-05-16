import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const importFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/import-formatting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // Check if there's non-import code before this import
    const parent = node.parent
    if (!parent || parent.type !== 'program') return null

    let sawNonImport = false
    let lastNonImportEndRow = -1
    for (const child of parent.namedChildren) {
      if (child?.id === node.id) {
        if (sawNonImport) {
          // If there is a multi-blank-line gap (>=3 lines between the end of
          // the previous non-import statement and the start of this import),
          // treat it as a logical module boundary (e.g. aggregated source
          // files where multiple self-contained sections coexist) and skip
          // the violation. A single blank line + comment is normal spacing
          // (gap == 2); only 3+ blank/comment lines indicate a section break.
          const importStartRow = node.startPosition.row
          // Rows are 0-indexed; "lines between" = (startRow - endRow - 1).
          if (importStartRow - lastNonImportEndRow - 1 >= 3) {
            return null
          }
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Import not at top of file',
            'Import statement found after non-import code. Group all imports at the top.',
            sourceCode,
            'Move this import to the top of the file with the other imports.',
          )
        }
        return null
      }
      // Skip comments and type imports
      if (
        child.type !== 'import_statement' &&
        child.type !== 'comment' &&
        child.type !== 'empty_statement'
      ) {
        // Skip directive prologues — string-literal expression statements that
        // appear before any code (per the ECMAScript "directive prologue" spec).
        // Covers 'use strict', 'use client', 'use server', 'use cache', and any
        // future directive without hardcoding framework-specific names.
        if (child.type === 'expression_statement') {
          const expr = child.namedChildren[0]
          if (expr?.type === 'string') continue
        }
        // Skip TypeScript type-only / ambient declarations — they have no
        // runtime emission, so an import that follows them is still
        // effectively at the top of the runtime module.
        // - ambient_declaration: `declare const/function/class/var/...`
        // - interface_declaration: `interface Foo {}`
        // - type_alias_declaration: `type Foo = ...`
        // - module_declaration: `declare module 'x' {}` / `namespace N {}`
        if (
          child.type === 'ambient_declaration' ||
          child.type === 'interface_declaration' ||
          child.type === 'type_alias_declaration' ||
          child.type === 'module_declaration' ||
          child.type === 'internal_module'
        ) {
          continue
        }
        sawNonImport = true
        lastNonImportEndRow = child.endPosition.row
      }
    }

    return null
  },
}
