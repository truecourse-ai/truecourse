import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'

/**
 * In WCF, a `[ServiceContract]` type exposes only the methods marked
 * `[OperationContract]`. A method without it is silently not part of the
 * contract — almost always a mistake. Flag the first such method on a
 * `[ServiceContract]` type that has at least one OperationContract (so we know
 * the contract is genuinely WCF and not just a coincidentally-named attribute).
 */
export const csharpMissingOperationContractVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-operationcontract',
  languages: ['csharp'],
  nodeTypes: ['interface_declaration', 'class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!getCSharpAttributeNames(node).includes('ServiceContract')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const methods = body.namedChildren.filter((m) => m?.type === 'method_declaration')
    if (methods.length === 0) return null

    const hasAnyOperation = methods.some((m) => getCSharpAttributeNames(m!).includes('OperationContract'))
    if (!hasAnyOperation) return null

    for (const method of methods) {
      if (getCSharpAttributeNames(method!).includes('OperationContract')) continue
      const name = method!.childForFieldName('name')?.text ?? 'method'
      return makeViolation(
        this.ruleKey, method!, filePath, 'low',
        'Method missing OperationContract',
        `Method '${name}' on a [ServiceContract] type lacks [OperationContract], so it is not exposed by the service.`,
        sourceCode,
        `Add [OperationContract] to '${name}', or remove it from the contract interface.`,
      )
    }
    return null
  },
}
