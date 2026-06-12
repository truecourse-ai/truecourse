import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import type { CodeViolation } from '@truecourse/shared'
import { makeViolation } from '../../../types.js'
import { getCSharpDeclAttributeNames } from './_helpers.js'

const OBSOLETE_DECLARATION_TYPES = new Set([
  'method_declaration', 'class_declaration', 'struct_declaration',
  'record_declaration', 'interface_declaration', 'enum_declaration',
  'property_declaration', 'field_declaration', 'event_field_declaration',
  'delegate_declaration',
])

/**
 * Well-known deprecated BCL APIs (.NET SYSLIB obsoletions). BinaryFormatter
 * and friends are intentionally absent — security/unsafe-pickle-usage owns
 * them, and double-firing two rules on one line helps nobody.
 */
const DEPRECATED_BCL_CALLS: Array<{ match: RegExp; api: string; replacement: string }> = [
  { match: /^WebRequest\.Create/, api: 'WebRequest.Create', replacement: 'HttpClient' },
  { match: /^Assembly\.LoadWithPartialName$/, api: 'Assembly.LoadWithPartialName', replacement: 'Assembly.Load with a full name' },
  { match: /^AppDomain\.CreateDomain$/, api: 'AppDomain.CreateDomain', replacement: 'AssemblyLoadContext' },
]

function declaredNames(decl: SyntaxNode): string[] {
  if (decl.type === 'field_declaration' || decl.type === 'event_field_declaration') {
    const variable = decl.namedChildren.find((c) => c?.type === 'variable_declaration')
    return (variable?.namedChildren ?? [])
      .filter((c) => c?.type === 'variable_declarator')
      .map((c) => c!.childForFieldName('name')?.text ?? '')
      .filter(Boolean)
  }
  const name = decl.childForFieldName('name')?.text
  return name ? [name] : []
}

export const csharpDeprecatedApiUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deprecated-api-usage',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    // Part 1: in-file [Obsolete] declarations that are still referenced.
    const obsoleteNames = new Set<string>()
    const declarationIds = new Set<number>()

    function collectObsolete(n: SyntaxNode) {
      const attrs = OBSOLETE_DECLARATION_TYPES.has(n.type) ? getCSharpDeclAttributeNames(n) : []
      if (attrs.includes('Obsolete') || attrs.includes('ObsoleteAttribute')) {
        for (const name of declaredNames(n)) obsoleteNames.add(name)
        declarationIds.add(n.id)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) collectObsolete(child)
      }
    }
    collectObsolete(node)

    const obsoleteHit = obsoleteNames.size > 0
      ? findObsoleteReference(node, obsoleteNames, declarationIds, filePath, sourceCode, this.ruleKey)
      : null
    if (obsoleteHit) return obsoleteHit

    // Part 2: well-known deprecated BCL APIs.
    return findDeprecatedBclUsage(node, filePath, sourceCode, this.ruleKey)
  },
}

function findObsoleteReference(
  root: SyntaxNode,
  names: Set<string>,
  declarationIds: Set<number>,
  filePath: string,
  sourceCode: string,
  ruleKey: string,
): CodeViolation | null {
  function walk(n: SyntaxNode): CodeViolation | null {
    if (n.type === 'identifier' && names.has(n.text)) {
      // Skip references inside the obsolete declaration itself and inside
      // using directives.
      let ancestor: SyntaxNode | null = n.parent
      let skip = false
      while (ancestor) {
        if (declarationIds.has(ancestor.id) || ancestor.type === 'using_directive') {
          skip = true
          break
        }
        ancestor = ancestor.parent
      }
      // A member name under a non-this receiver may belong to an unrelated
      // type that shares the name — stay conservative.
      const parent = n.parent
      if (!skip && (parent?.type === 'member_access_expression' || parent?.type === 'member_binding_expression')
        && parent.childForFieldName('name')?.id === n.id
        && parent.childForFieldName('expression')?.type !== 'this_expression') {
        skip = true
      }
      // Object-initializer member assignments (`new Dto { Status = x }`)
      // name a member of the constructed type, not this file's symbol.
      if (!skip && parent?.type === 'assignment_expression'
        && parent.childForFieldName('left')?.id === n.id
        && parent.parent?.type === 'initializer_expression') {
        skip = true
      }
      if (!skip) {
        return makeViolation(
          ruleKey, n, filePath, 'medium',
          'Deprecated API usage',
          `\`${n.text}\` is marked [Obsolete]. Migrate to the recommended replacement.`,
          sourceCode,
          'Read the [Obsolete] attribute message for the recommended replacement and update your code.',
        )
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) {
        const v = walk(child)
        if (v) return v
      }
    }
    return null
  }
  return walk(root)
}

function findDeprecatedBclUsage(
  root: SyntaxNode,
  filePath: string,
  sourceCode: string,
  ruleKey: string,
): CodeViolation | null {
  function walk(n: SyntaxNode): CodeViolation | null {
    // `new WebClient()` — deprecated since .NET 6 (SYSLIB0014).
    if (n.type === 'object_creation_expression') {
      const typeName = n.childForFieldName('type')?.text.split('.').pop()
      if (typeName === 'WebClient' || typeName === 'HttpWebRequest') {
        return makeViolation(
          ruleKey, n, filePath, 'medium',
          'Deprecated API usage',
          `\`${typeName}\` is deprecated (SYSLIB0014). Use \`HttpClient\` instead.`,
          sourceCode,
          'Replace the WebClient/HttpWebRequest usage with HttpClient (ideally via IHttpClientFactory).',
        )
      }
    }
    if (n.type === 'invocation_expression') {
      const fnText = n.childForFieldName('function')?.text ?? ''
      for (const { match, api, replacement } of DEPRECATED_BCL_CALLS) {
        if (match.test(fnText)) {
          return makeViolation(
            ruleKey, n, filePath, 'medium',
            'Deprecated API usage',
            `\`${api}\` is deprecated. Use ${replacement} instead.`,
            sourceCode,
            `Replace \`${api}\` with ${replacement}.`,
          )
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (child) {
        const v = walk(child)
        if (v) return v
      }
    }
    return null
  }
  return walk(root)
}
