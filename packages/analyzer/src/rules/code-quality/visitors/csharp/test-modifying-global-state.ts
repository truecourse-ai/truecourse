import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpTestMethod } from './_helpers.js'

const CLEANUP_ATTRS = new Set([
  'SetUp', 'TearDown', 'OneTimeSetUp', 'OneTimeTearDown', // NUnit
  'TestInitialize', 'TestCleanup', 'ClassInitialize', 'ClassCleanup', // MSTest
])

/**
 * A test method assigning a STATIC field of its class leaks state into other
 * tests (xUnit even runs collections in parallel). Fields that are re-set in
 * a setup/teardown hook, the constructor, or Dispose are considered managed
 * and skipped.
 */
export const csharpTestModifyingGlobalStateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-modifying-global-state',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Static mutable fields of this class.
    const staticFields = new Set<string>()
    for (const member of body.namedChildren) {
      if (member?.type !== 'field_declaration') continue
      if (!hasCSharpModifier(member, 'static')) continue
      if (hasCSharpModifier(member, 'const') || hasCSharpModifier(member, 'readonly')) continue
      const decl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
      for (const d of decl?.namedChildren ?? []) {
        if (d?.type !== 'variable_declarator') continue
        const name = d.childForFieldName('name')?.text
        if (name) staticFields.add(name)
      }
    }
    if (staticFields.size === 0) return null

    // Fields re-initialized by lifecycle hooks are managed state.
    const managed = new Set<string>()
    const collectAssignments = (scope: SyntaxNode, into: (name: string) => void) => {
      const walk = (n: SyntaxNode) => {
        if (n.type === 'assignment_expression') {
          const left = n.childForFieldName('left')
          const name = left?.type === 'identifier' ? left.text : left?.text.split('.').pop()
          if (name) into(name)
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) walk(child)
        }
      }
      walk(scope)
    }

    for (const member of body.namedChildren) {
      if (!member) continue
      const isLifecycle =
        member.type === 'constructor_declaration'
        || (member.type === 'method_declaration'
          && (member.childForFieldName('name')?.text === 'Dispose'
            || getCSharpDeclAttributeNames(member).some((a) => CLEANUP_ATTRS.has(a))))
      if (isLifecycle) collectAssignments(member, (name) => managed.add(name))
    }

    // Find an assignment to an unmanaged static field inside a test method.
    for (const member of body.namedChildren) {
      if (!member || !isCSharpTestMethod(member)) continue
      let hit: SyntaxNode | null = null
      const walk = (n: SyntaxNode) => {
        if (hit) return
        if (n.type === 'assignment_expression') {
          const left = n.childForFieldName('left')
          const name = left?.type === 'identifier' ? left.text : null
          if (name && staticFields.has(name) && !managed.has(name)) {
            hit = n
            return
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) walk(child)
        }
      }
      walk(member)
      if (hit) {
        const fieldName = (hit as SyntaxNode).childForFieldName('left')?.text ?? 'field'
        return makeViolation(
          this.ruleKey, hit, filePath, 'medium',
          'Test modifies shared static state',
          `Test assigns static field \`${fieldName}\` without resetting it in a setup/teardown hook — state leaks between tests and breaks parallel runs.`,
          sourceCode,
          'Make the field instance-level (xUnit creates a fresh class per test), or reset it in a setup/teardown hook.',
        )
      }
    }
    return null
  },
}
