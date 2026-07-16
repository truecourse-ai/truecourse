import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const TYPE_DECL_KINDS = ['class_declaration', 'struct_declaration', 'record_declaration', 'interface_declaration']

/** Name of the type (class/struct/record/interface) that encloses this node. */
function enclosingTypeName(node: SyntaxNode): string | null {
  let anc: SyntaxNode | null = node.parent
  while (anc && !TYPE_DECL_KINDS.includes(anc.type)) anc = anc.parent
  return anc?.childForFieldName('name')?.text ?? null
}

/**
 * A fluent builder/setter method returns a chainable type: its own containing
 * type (an instance builder like `OrchardCoreBuilder Configure(...)`) or, for
 * an extension method, the extended `this` receiver's type (`Builder
 * Attachable(this Builder builder, bool attachable = true)`). A parameter named
 * after such a method is the idiomatic "value the setter carries", not a
 * copy-paste artifact, so the match must not be flagged.
 */
function isFluentBuilder(method: SyntaxNode): boolean {
  const returns = method.childForFieldName('returns')?.text
  if (!returns || returns === 'void') return false

  if (returns === enclosingTypeName(method)) return true

  const params = method.childForFieldName('parameters')
  const first = params?.namedChildren.find((c) => c?.type === 'parameter')
  if (first) {
    const isExtensionReceiver = first.namedChildren.some((c) => c?.type === 'modifier' && c.text === 'this')
    if (isExtensionReceiver && first.childForFieldName('type')?.text === returns) return true
  }
  return false
}

/**
 * A parameter whose name matches its enclosing method's name (case-insensitively)
 * is almost always a copy-paste artifact and reads confusingly at the call site.
 * The check fires on a `method_declaration` with a `parameter` whose identifier
 * equals the method name — except on fluent builder/setter methods, where a
 * value parameter mirroring the method name is the intended idiom.
 */
export const csharpParameterDuplicatesMethodNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/parameter-duplicates-method-name',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const methodName = node.childForFieldName('name')?.text
    if (!methodName) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Fluent builder/setter parameters idiomatically mirror the method name.
    if (isFluentBuilder(node)) return null

    for (const param of params.namedChildren) {
      if (param?.type !== 'parameter') continue
      const pName = param.childForFieldName('name')?.text
      if (pName && pName.toLowerCase() === methodName.toLowerCase()) {
        return makeViolation(
          this.ruleKey, param, filePath, 'low',
          'Parameter duplicates the method name',
          `Parameter \`${pName}\` has the same name as its method \`${methodName}\` — likely a copy-paste artifact.`,
          sourceCode,
          'Rename the parameter to describe the value it carries.',
        )
      }
    }
    return null
  },
}
