import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * F842: Detects local variables that are annotated with a type but never assigned a value.
 * e.g.:
 *   x: int  # annotated but never assigned
 */
export const pythonUnusedAnnotationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-annotation',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Collect all annotated names (type: annotation without assignment)
    const annotatedOnly = new Set<string>()
    const assigned = new Set<string>()

    // Walk the function body recursively to find ALL assignments
    // (including those inside if/try/for/while blocks). The
    // forward-decl pattern \`payload: dict[str, Any]\` followed by
    // \`payload = ...\` inside a try block was previously missed.
    function walk(n: import('web-tree-sitter').Node): void {
      const inner = n.type === 'expression_statement' ? n.namedChildren[0] : n
      if (inner?.type === 'assignment') {
        const typeField = inner.childForFieldName('type')
        const val = inner.childForFieldName('right')
        const name = inner.childForFieldName('left')
        const nameText = name?.type === 'identifier' ? name.text : null
        if (nameText) {
          if (val) assigned.add(nameText)
          else if (typeField) annotatedOnly.add(nameText)
        }
      } else if (inner?.type === 'augmented_assignment') {
        const name = inner.childForFieldName('left')
        if (name?.type === 'identifier') assigned.add(name.text)
      }
      // Don't descend into nested function definitions — they shadow.
      if (n.type === 'function_definition' && n !== body) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }
    walk(body)

    // Find names that are annotated-only and never assigned
    for (const stmt of body.namedChildren) {
      const inner = stmt.type === 'expression_statement' ? stmt.namedChildren[0] : stmt
      if (inner?.type === 'assignment') {
        const typeField = inner.childForFieldName('type')
        const val = inner.childForFieldName('right')
        const name = inner.childForFieldName('left')
        if (typeField && !val && name?.type === 'identifier' && !assigned.has(name.text)) {
          return makeViolation(
            this.ruleKey, stmt, filePath, 'low',
            'Unused variable annotation',
            `\`${name.text}\` is annotated but never assigned a value — the annotation is dead code.`,
            sourceCode,
            `Remove the annotation for \`${name.text}\` or assign a value to it.`,
          )
        }
      }
    }

    return null
  },
}
