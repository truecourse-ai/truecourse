import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

/**
 * Detects a variable assigned immediately then reassigned without any use in between.
 *   x = 1
 *   x = 2   ← second declaration overwrites first
 */
export const pythonRedeclaredAssignedNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redeclared-assigned-name',
  languages: ['python'],
  nodeTypes: ['block', 'module'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    const lastAssignment = new Map<string, number>() // name → index of last assignment

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.type === 'expression_statement') {
        const expr = child.namedChildren[0]
        if (!expr) continue
        if (expr.type === 'assignment') {
          const target = expr.childForFieldName('left')
          if (!target || target.type !== 'identifier') continue

          // Skip bare type annotations (e.g., `x: int` without `= value`).
          // Tree-sitter parses these as `assignment` nodes without a `right` field.
          const rhs = expr.childForFieldName('right')
          if (!rhs) continue

          const name = target.text
          if (lastAssignment.has(name)) {
            // Skip sequential transforms: x = x.strip(), x = x.replace(...), etc.
            if (containsPythonIdentifierExact(rhs, name)) {
              lastAssignment.set(name, i)
              continue
            }

            // Skip init-before-try pattern: x = None; try: x = compute()
            // If the current assignment is inside a try block, the previous one is intentional init
            const prevIdx = lastAssignment.get(name)!
            const nextStmt = children[prevIdx + 1]
            if (nextStmt && nextStmt.type === 'try_statement') {
              lastAssignment.set(name, i)
              continue
            }

            // Skip step-tracker pattern: variable is reassigned inside a try body
            // and read in the except handler for error context (e.g., step = "phase1"; ... step = "phase2";
            // except: log(f"failed at {step}")).
            if (node.type === 'block' && node.parent?.type === 'try_statement') {
              const tryStmt = node.parent
              const exceptClauses = tryStmt.namedChildren.filter((c) => c.type === 'except_clause')
              if (exceptClauses.some((clause) => containsPythonIdentifierExact(clause, name))) {
                lastAssignment.set(name, i)
                continue
              }
            }

            // Check that between previous assignment and this one there's no reference to name
            let usedBetween = false
            for (let j = prevIdx + 1; j < i; j++) {
              const between = children[j]
              if (containsPythonIdentifierExact(between, name)) {
                usedBetween = true
                break
              }
            }
            if (!usedBetween) {
              return makeViolation(
                this.ruleKey, child, filePath, 'medium',
                'Variable redeclared without use',
                `\`${name}\` is assigned again without being used since the previous assignment — the previous value is lost.`,
                sourceCode,
                `Remove the first assignment to \`${name}\` or use its value before reassigning.`,
              )
            }
          }
          lastAssignment.set(name, i)
        } else {
          // Any other expression — references may occur; clear assignments for names that appear
          for (const [name] of lastAssignment) {
            if (containsPythonIdentifierExact(child, name)) {
              lastAssignment.delete(name)
            }
          }
        }
      } else {
        // Non-assignment statement — references names
        for (const [name] of lastAssignment) {
          if (containsPythonIdentifierExact(child, name)) {
            lastAssignment.delete(name)
          }
        }
      }
    }

    return null
  },
}
