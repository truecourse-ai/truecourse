import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

type MemberKind = 'get' | 'set' | 'method' | 'field'

interface MemberInfo {
  kinds: Set<MemberKind>
}

export const duplicateClassMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-class-members',
  languages: JS_LANGUAGES,
  nodeTypes: ['class_body'],
  visit(node, filePath, sourceCode) {
    const seen = new Map<string, MemberInfo>()
    for (const child of node.namedChildren) {
      if (
        child.type !== 'method_definition' &&
        child.type !== 'public_field_definition' &&
        child.type !== 'field_definition'
      ) continue

      const nameNode = child.childForFieldName('name')
      if (!nameNode) continue
      const name = nameNode.text

      // Static and instance members live in different namespaces — `static
      // ruleNames` (on the class) does not collide with `get ruleNames()`
      // (on the prototype). Detect via anonymous `static` keyword token.
      // get/set accessor pairs are detected the same way (anonymous `get` /
      // `set` keyword tokens precede the property name).
      let isStatic = false
      let accessor: 'get' | 'set' | null = null
      for (let i = 0; i < child.childCount; i++) {
        const c = child.child(i)
        if (!c) continue
        if (c.type === 'static') isStatic = true
        else if (c.type === 'get') accessor = 'get'
        else if (c.type === 'set') accessor = 'set'
      }

      const kind: MemberKind = accessor ?? (child.type === 'method_definition' ? 'method' : 'field')
      const key = `${isStatic ? 'static' : 'instance'}:${name}`

      const existing = seen.get(key)
      if (!existing) {
        seen.set(key, { kinds: new Set([kind]) })
        continue
      }

      // Same name in the same scope (static or instance). A get/set pair
      // is the only legitimate complementary shape; everything else
      // (method + method, field + field, get + get, set + set, method +
      // field, etc.) is a true duplicate.
      const isGetSetPair =
        (existing.kinds.size === 1 && existing.kinds.has('get') && kind === 'set') ||
        (existing.kinds.size === 1 && existing.kinds.has('set') && kind === 'get')
      if (!isGetSetPair) {
        return reportDuplicate(this.ruleKey, child, filePath, sourceCode, name)
      }
      existing.kinds.add(kind)
    }
    return null
  },
}

function reportDuplicate(
  ruleKey: string, child: SyntaxNode, filePath: string, sourceCode: string, name: string,
) {
  return makeViolation(
    ruleKey, child, filePath, 'high',
    'Duplicate class member',
    `Member \`${name}\` is defined more than once — the later definition silently overwrites the earlier one.`,
    sourceCode,
    'Remove the duplicate member or rename one of them.',
  )
}
