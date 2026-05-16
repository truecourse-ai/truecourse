import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Collects every identifier introduced by a variable_declarator's name,
 * supporting plain identifiers, array_pattern, object_pattern, and rest patterns.
 */
function collectBoundNames(nameNode: SyntaxNode | null, out: Set<string>): void {
  if (!nameNode) return
  switch (nameNode.type) {
    case 'identifier':
    case 'shorthand_property_identifier_pattern':
      out.add(nameNode.text)
      return
    case 'array_pattern':
    case 'object_pattern':
      for (let i = 0; i < nameNode.namedChildCount; i++) {
        collectBoundNames(nameNode.namedChild(i), out)
      }
      return
    case 'rest_pattern':
      for (let i = 0; i < nameNode.namedChildCount; i++) {
        collectBoundNames(nameNode.namedChild(i), out)
      }
      return
    case 'pair_pattern': {
      // { key: value } — only the value side introduces a binding.
      const value = nameNode.childForFieldName('value')
      collectBoundNames(value, out)
      return
    }
    case 'assignment_pattern': {
      // identifier = default — only the left side is a binding.
      const left = nameNode.childForFieldName('left') ?? nameNode.namedChild(0)
      collectBoundNames(left, out)
      return
    }
    default:
      // Fallback: recurse into named children to catch wrapper nodes.
      for (let i = 0; i < nameNode.namedChildCount; i++) {
        collectBoundNames(nameNode.namedChild(i), out)
      }
      return
  }
}

/**
 * Collects every identifier appearing on the LHS of an assignment target,
 * including destructuring patterns.
 */
function collectAssignmentTargets(target: SyntaxNode | null, out: Set<string>): void {
  if (!target) return
  switch (target.type) {
    case 'identifier':
      out.add(target.text)
      return
    case 'array_pattern':
    case 'object_pattern':
      for (let i = 0; i < target.namedChildCount; i++) {
        collectAssignmentTargets(target.namedChild(i), out)
      }
      return
    case 'rest_pattern':
      for (let i = 0; i < target.namedChildCount; i++) {
        collectAssignmentTargets(target.namedChild(i), out)
      }
      return
    case 'pair_pattern': {
      const value = target.childForFieldName('value')
      collectAssignmentTargets(value, out)
      return
    }
    case 'assignment_pattern': {
      const left = target.childForFieldName('left') ?? target.namedChild(0)
      collectAssignmentTargets(left, out)
      return
    }
    case 'member_expression':
    case 'subscript_expression':
      // Mutating a property is not a rebinding of the variable itself.
      return
    default:
      for (let i = 0; i < target.namedChildCount; i++) {
        collectAssignmentTargets(target.namedChild(i), out)
      }
  }
}

export const preferConstVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-const',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['lexical_declaration'],
  visit(node, filePath, sourceCode) {
    if (!node.text.startsWith('let ')) return null

    const declarators = node.namedChildren.filter((c): c is SyntaxNode => !!c && c.type === 'variable_declarator')
    if (declarators.length === 0) return null

    // Collect every name introduced by every declarator on this `let`.
    // Because `let a, b` shares one keyword, we can only convert to `const`
    // if NO bound name is later reassigned.
    const allNames = new Set<string>()
    for (const declarator of declarators) {
      collectBoundNames(declarator.childForFieldName('name'), allNames)
    }
    if (allNames.size === 0) return null

    // A bare `let x;` with no initializer cannot be const.
    for (const declarator of declarators) {
      if (!declarator.childForFieldName('value')) return null
    }

    // If this `let` is the init of a for-loop (`for (let ...; ...; ...)`),
    // for-in or for-of, the loop header itself counts as a rebinding context:
    //   - C-style for-loops require `let` if any name is updated via the update
    //     clause (e.g. `i++`); we still detect that through update_expression.
    //   - `for (let x of ...)` / `for (let x in ...)` rebinds each iteration,
    //     so converting to `const` would semantically be allowed but ESLint's
    //     prefer-const allows that. However, mixing const + let in one for
    //     init is impossible, so we treat all names atomically below.

    const scope = node.parent
    if (!scope) return null

    let anyReassigned = false

    const visit = (n: SyntaxNode): void => {
      if (anyReassigned) return

      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        const targets = new Set<string>()
        collectAssignmentTargets(left, targets)
        for (const t of targets) {
          if (allNames.has(t)) {
            anyReassigned = true
            return
          }
        }
      } else if (n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        const targets = new Set<string>()
        collectAssignmentTargets(left, targets)
        for (const t of targets) {
          if (allNames.has(t)) {
            anyReassigned = true
            return
          }
        }
      } else if (n.type === 'update_expression') {
        // ++ / -- on an identifier.
        const arg = n.childForFieldName('argument') ?? n.namedChild(0)
        if (arg && arg.type === 'identifier' && allNames.has(arg.text)) {
          anyReassigned = true
          return
        }
      } else if (n.type === 'for_in_statement') {
        // `for (name of …)` / `for (name in …)` where name is one of ours
        // (but NOT this very declaration) counts as a reassignment of name.
        if (n.id !== node.parent?.id) {
          const left = n.childForFieldName('left')
          const targets = new Set<string>()
          collectAssignmentTargets(left, targets)
          for (const t of targets) {
            if (allNames.has(t)) {
              anyReassigned = true
              return
            }
          }
        }
      }

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) visit(child)
      }
    }

    visit(scope)

    if (anyReassigned) return null

    // All names are const-eligible — emit a single violation for the declaration.
    // Use the first declarator's name for the message (simple identifier or pattern text).
    const firstNameNode = declarators[0].childForFieldName('name')
    const displayName = firstNameNode?.text ?? Array.from(allNames).join(', ')

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'low',
      'Prefer const',
      `\`let ${displayName}\` is never reassigned. Use \`const\` instead for immutability.`,
      sourceCode,
      'Replace `let` with `const`.',
    )
  },
}
