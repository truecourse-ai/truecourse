import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * Unlike JS, C# constructors are not inherited — a forwarding
 * `Child(x) : base(x) { }` is required to exist and is never useless. The
 * only removable form is a lone public parameterless constructor with an
 * empty body: the compiler already provides exactly that as the default.
 */
export const csharpUselessConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-constructor',
  languages: ['csharp'],
  nodeTypes: ['constructor_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public')) return null
    if (hasCSharpModifier(node, 'static')) return null
    // [JsonConstructor] etc. mark the constructor for a framework.
    if (getCSharpAttributeNames(node).length > 0) return null

    const params = node.childForFieldName('parameters')
    if (params && params.namedChildCount > 0) return null
    if (node.namedChildren.some((c) => c?.type === 'constructor_initializer')) return null

    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null
    if (body.namedChildCount > 0) return null
    for (let i = 0; i < body.childCount; i++) {
      if (body.child(i)?.type === 'comment') return null
    }

    // If any other constructor exists, the parameterless one is load-bearing:
    // the compiler stops generating the default as soon as one is declared.
    const classBody = node.parent
    if (!classBody) return null
    const ctorCount = classBody.namedChildren.filter((c) => c?.type === 'constructor_declaration').length
    if (ctorCount !== 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Useless constructor',
      'An empty public parameterless constructor duplicates the compiler-provided default — it can be removed.',
      sourceCode,
      'Remove the constructor — the compiler generates an identical default constructor.',
    )
  },
}
