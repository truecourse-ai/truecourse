import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A XAML markup-extension property carrying <c>[ConstructorArgument("name")]</c> whose
 * name matches no parameter of any constructor on the type (S4260). The XAML parser uses
 * that attribute to map a positional constructor argument onto the property; when the name
 * is wrong (a rename or a typo) the mapping silently breaks and the extension is
 * mis-instantiated. Purely structural — the attribute's string against the type's own
 * constructor parameter names — so no reference assemblies are needed.
 */
export const csharpConstructorArgumentNoMatchingPropertyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constructorargument-no-matching-property',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    const argName = constructorArgumentName(node)
    if (argName === null) return null

    const cls = node.parent?.parent
    if (cls?.type !== 'class_declaration') return null
    if (constructorParamNames(cls).has(argName)) return null

    return makeViolation(
      this.ruleKey, node.childForFieldName('name') ?? node, filePath, 'medium',
      'ConstructorArgument does not match a constructor parameter',
      `[ConstructorArgument("${argName}")] names no constructor parameter on this type, so the XAML parser cannot map it and the markup extension is mis-instantiated.`,
      sourceCode,
      `Match the [ConstructorArgument] name to an existing constructor parameter (or rename the parameter to '${argName}').`,
    )
  },
}

/** The string value of a `[ConstructorArgument("...")]` on this declaration, or null. */
function constructorArgumentName(node: SyntaxNode): string | null {
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const name = (attr.childForFieldName('name')?.text.split('.').pop() ?? '').replace(/Attribute$/, '')
      if (name !== 'ConstructorArgument') continue
      const argList = attr.namedChildren.find((c) => c?.type === 'attribute_argument_list')
      const firstArg = argList?.namedChildren.find((c) => c?.type === 'attribute_argument')
      const literal = firstArg?.namedChildren.find((c) => c?.type === 'string_literal' || c?.type === 'verbatim_string_literal')
      if (literal) return stringLiteralValue(literal)
    }
  }
  return null
}

/** Names of every constructor parameter declared on the type. */
function constructorParamNames(cls: SyntaxNode): Set<string> {
  const names = new Set<string>()
  const body = cls.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return names
  for (const member of body.namedChildren) {
    if (member?.type !== 'constructor_declaration') continue
    const params = member.childForFieldName('parameters')?.namedChildren ?? []
    for (const p of params) {
      if (p?.type !== 'parameter') continue
      const pn = p.childForFieldName('name')?.text
      if (pn) names.add(pn)
    }
  }
  return names
}

/** The text of a string literal with surrounding quotes stripped. */
function stringLiteralValue(node: SyntaxNode): string {
  for (const child of node.namedChildren) {
    if (child?.type === 'string_literal_content') return child.text
  }
  return node.text.replace(/^@?"|"$/g, '')
}
