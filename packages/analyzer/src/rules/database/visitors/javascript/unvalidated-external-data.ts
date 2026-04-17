import type { CodeRuleVisitor } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, ORM_WRITE_METHODS, SQL_WRITE_METHODS } from './_helpers.js'
import { findUserInputAccess } from '../../../_shared/javascript-helpers.js'

export const unvalidatedExternalDataVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unvalidated-external-data',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    const methodName = getMethodName(node)
    if (!ORM_WRITE_METHODS.has(methodName) && !SQL_WRITE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Real AST + scope-aware external-data detection. See _shared/javascript-helpers.ts.
    // Replaces the previous identifier-name check that flagged any local variable
    // named `body` / `payload` / `data` as external — a massive FP source on
    // codebases that use those names for non-request data (cache reads,
    // computed values, internal events).
    for (const arg of args.namedChildren) {
      if (findUserInputAccess(arg, dataFlow)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unvalidated external data used in database write',
          `External data (e.g., \`req.body\`, \`request.params\`) passed directly to \`${methodName}()\` without schema validation. Validate input with a schema library (e.g., \`zod\`, \`joi\`) before writing to the database.`,
          sourceCode,
          'Parse and validate external data with a schema library before using it in database operations.',
        )
      }
    }

    return null
  },
}
