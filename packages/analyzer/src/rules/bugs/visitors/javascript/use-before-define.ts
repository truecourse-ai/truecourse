import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

export const useBeforeDefineVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/use-before-define',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null
    const vars = dataFlow.usedBeforeDefined()
    for (const v of vars) {
      // Find the earliest use site that is before the declaration
      const declPos = v.declarationNode.startIndex
      const earliestUseSite = v.useSites
        .filter(u => u.node.startIndex < declPos)
        .sort((a, b) => a.node.startIndex - b.node.startIndex)[0]
      if (!earliestUseSite) continue

      // Skip when usage is inside a function body — the function only executes
      // after module initialization, so the const IS defined by execution time.
      // Also skip TYPE-ONLY references (`type X = z.infer<typeof Z>`,
      // `interface I extends Other`, `function f(x: TLater)` — TS hoists
      // type declarations and TDZ doesn't apply.
      let parent = earliestUseSite.node.parent
      let insideFunction = false
      let insideTypePosition = false
      while (parent) {
        if (parent.type === 'function_declaration' || parent.type === 'arrow_function' ||
            parent.type === 'function_expression' || parent.type === 'method_definition') {
          insideFunction = true
          break
        }
        // TS type positions
        if (
          parent.type === 'type_alias_declaration' ||
          parent.type === 'interface_declaration' ||
          parent.type === 'type_annotation' ||
          parent.type === 'opting_type_annotation' ||
          parent.type === 'type_parameter' ||
          parent.type === 'type_arguments' ||
          parent.type === 'type_query' ||           // `typeof X`
          parent.type === 'predefined_type' ||
          parent.type === 'generic_type' ||
          parent.type === 'extends_type_clause' ||
          parent.type === 'extends_clause' ||
          parent.type === 'implements_clause' ||
          parent.type === 'union_type' ||
          parent.type === 'intersection_type' ||
          parent.type === 'tuple_type' ||
          parent.type === 'array_type' ||
          parent.type === 'mapped_type_clause' ||
          parent.type === 'conditional_type' ||
          parent.type === 'infer_type' ||
          parent.type === 'literal_type'
        ) {
          insideTypePosition = true
          break
        }
        parent = parent.parent
      }
      if (insideFunction) continue
      if (insideTypePosition) continue

      // Skip when the usage is INSIDE an `import` statement — imports are
      // hoisted by the loader, so an `import { X as Y } from 'p'` doesn't
      // care about declaration order downstream.
      let p2 = earliestUseSite.node.parent
      while (p2) {
        if (p2.type === 'import_statement' || p2.type === 'import_clause') {
          insideTypePosition = true
          break
        }
        p2 = p2.parent
      }
      if (insideTypePosition) continue
      return makeViolation(
        this.ruleKey,
        earliestUseSite.node,
        filePath,
        'high',
        'Variable used before definition',
        `Variable \`${v.name}\` is used before it is declared. Move the declaration above the first use.`,
        sourceCode,
        'Declare the variable before its first use to avoid a ReferenceError (TDZ for let/const).',
      )
    }
    return null
  },
}
