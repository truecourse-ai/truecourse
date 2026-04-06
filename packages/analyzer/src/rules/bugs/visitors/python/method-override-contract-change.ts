import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects when a method override changes the parameter count compared to the
 * parent class. Heuristic: finds class with `extends`/superclass, looks at
 * methods in the current class, and compares with methods of the same name in
 * any base class defined in the same file.
 */

function getMethodSignatures(classNode: SyntaxNode): Map<string, { paramCount: number, node: SyntaxNode }> {
  const methods = new Map<string, { paramCount: number, node: SyntaxNode }>()
  const body = classNode.childForFieldName('body')
  if (!body) return methods

  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i)
    if (!child || child.type !== 'function_definition') continue

    const name = child.childForFieldName('name')
    if (!name) continue

    const params = child.childForFieldName('parameters')
    if (!params) continue

    const paramCount = params.namedChildren.filter((c) =>
      c.type === 'identifier' || c.type === 'typed_parameter' ||
      c.type === 'default_parameter' || c.type === 'typed_default_parameter'
    ).length

    // Subtract 1 for self/cls
    const adjustedCount = Math.max(0, paramCount - 1)
    methods.set(name.text, { paramCount: adjustedCount, node: child })
  }
  return methods
}

function findClassDefinitions(root: SyntaxNode): SyntaxNode[] {
  const classes: SyntaxNode[] = []
  function walk(node: SyntaxNode) {
    if (node.type === 'class_definition') {
      classes.push(node)
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walk(child)
    }
  }
  walk(root)
  return classes
}

export const pythonMethodOverrideContractChangeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/method-override-contract-change',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    const allClasses = findClassDefinitions(node)
    const classByName = new Map<string, SyntaxNode>()
    for (const cls of allClasses) {
      const name = cls.childForFieldName('name')
      if (name) classByName.set(name.text, cls)
    }

    for (const cls of allClasses) {
      // Check if class has superclass
      const superclasses = cls.childForFieldName('superclasses')
      if (!superclasses) continue

      const baseNames: string[] = []
      for (let i = 0; i < superclasses.namedChildCount; i++) {
        const child = superclasses.namedChild(i)
        if (child && (child.type === 'identifier' || child.type === 'attribute')) {
          baseNames.push(child.text)
        }
      }

      const childMethods = getMethodSignatures(cls)

      for (const baseName of baseNames) {
        const baseClass = classByName.get(baseName)
        if (!baseClass) continue

        const parentMethods = getMethodSignatures(baseClass)

        for (const [methodName, childInfo] of childMethods) {
          // Skip dunder methods; those have their own checks
          if (methodName.startsWith('__') && methodName.endsWith('__')) continue

          const parentInfo = parentMethods.get(methodName)
          if (!parentInfo) continue

          if (childInfo.paramCount !== parentInfo.paramCount) {
            return makeViolation(
              this.ruleKey, childInfo.node, filePath, 'medium',
              'Method override changes contract',
              `\`${methodName}\` has ${childInfo.paramCount} parameter(s) but parent \`${baseName}.${methodName}\` has ${parentInfo.paramCount}. This may violate Liskov Substitution Principle.`,
              sourceCode,
              `Ensure \`${methodName}\` has the same parameter count as the parent method.`,
            )
          }
        }
      }
    }

    return null
  },
}
