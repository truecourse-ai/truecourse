import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// JavaScript identifier characters: letters, digits, `_`, `$`. Tree-sitter's
// `\b` word boundary doesn't include `$`, so identifiers like `$node` are
// incorrectly reported as unused when surrounded by non-word characters.
const IDENT_BOUNDARY = '[A-Za-z0-9_$]'

function buildIdentRegex(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<!${IDENT_BOUNDARY})${escaped}(?!${IDENT_BOUNDARY})`)
}

// Array.prototype iteration methods whose callback signature is
// `(element, index?, array?)`. When the callback uses `element` but ignores
// the trailing positional `index`/`array`, that's idiomatic — flagging the
// unused trailing parameter is a false positive.
const ARRAY_ITERATION_METHODS = new Set([
  'map', 'forEach', 'filter', 'reduce', 'reduceRight',
  'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex',
  'flatMap',
])

function isInArrayIterationCallback(node: { parent: unknown } | null): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parent: any = (node as any)?.parent
  if (parent?.type === 'arguments') parent = parent.parent
  if (parent?.type !== 'call_expression') return false
  const fn = parent.childForFieldName?.('function')
  if (fn?.type !== 'member_expression') return false
  const prop = fn.childForFieldName?.('property')
  if (!prop) return false
  return ARRAY_ITERATION_METHODS.has(prop.text)
}

export const unusedFunctionParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-function-parameter',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params || params.namedChildCount === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    const inIterationCallback = isInArrayIterationCallback(node)

    paramLoop: for (let i = 0; i < params.namedChildCount; i++) {
      const param = params.namedChild(i)
      if (!param) continue

      if (param.type === 'rest_parameter' || param.type === 'object_pattern'
        || param.type === 'array_pattern' || param.type === 'assignment_pattern') continue

      let paramName: string | null = null
      if (param.type === 'identifier') {
        paramName = param.text
      } else if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
        const nameNode = param.childForFieldName('pattern') ?? param.namedChildren[0]
        if (nameNode?.type === 'identifier') paramName = nameNode.text
      }

      if (!paramName) continue
      if (paramName.startsWith('_')) continue

      // Skip constructor parameters with accessibility modifiers (public, private, protected, readonly)
      // These are TypeScript parameter properties — they ARE used as class fields
      if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
        const paramText = param.text
        if (/^(public|private|protected|readonly)\s/.test(paramText)) continue
      }

      // Skip `request`/`req` in ALL exported functions (Next.js route handlers, Express middleware, etc.)
      if (paramName === 'request' || paramName === 'req') {
        let ancestor = node.parent
        while (ancestor) {
          if (ancestor.type === 'export_statement') {
            continue paramLoop
          }
          // Stop climbing at function boundaries
          if (ancestor.type === 'function_declaration' || ancestor.type === 'method_definition'
            || ancestor.type === 'class_declaration') break
          ancestor = ancestor.parent
        }
      }

      // Skip `job` param in async functions (BullMQ worker pattern)
      if (paramName === 'job') {
        const funcText = node.text
        const isAsync = funcText.startsWith('async ') || funcText.includes('async (') || funcText.includes('async(')
          || node.children.some((c) => c.type === 'async')
        if (isAsync) continue
      }

      // For block bodies ({...}), strip the braces. For expression bodies, use as-is.
      const bodyContent = body.type === 'statement_block' ? bodyText.slice(1, -1) : bodyText
      const re = buildIdentRegex(paramName)
      if (!re.test(bodyContent)) {
        // If there are later parameters that ARE used, this param is a positional placeholder
        // (e.g., Next.js route handlers: (request, { params }) where request is required)
        let laterParamUsed = false
        for (let j = i + 1; j < params.namedChildCount; j++) {
          const laterParam = params.namedChild(j)
          if (!laterParam) continue
          // Destructured or rest params are always "used"
          if (laterParam.type === 'object_pattern' || laterParam.type === 'array_pattern' || laterParam.type === 'rest_parameter') {
            laterParamUsed = true
            break
          }
          let laterName: string | null = null
          if (laterParam.type === 'identifier') laterName = laterParam.text
          else if (laterParam.type === 'required_parameter' || laterParam.type === 'optional_parameter') {
            const nameNode = laterParam.childForFieldName('pattern') ?? laterParam.namedChildren[0]
            if (nameNode?.type === 'identifier') laterName = nameNode.text
          }
          if (laterName && !laterName.startsWith('_')) {
            const laterRe = buildIdentRegex(laterName)
            if (laterRe.test(bodyContent)) {
              laterParamUsed = true
              break
            }
          }
        }
        if (laterParamUsed) continue

        // In Array.prototype iteration callbacks, trailing positional params
        // (`index`, `array`) are part of the method's contract — ignoring them
        // when an earlier param is used is idiomatic, not a bug.
        if (inIterationCallback && i > 0) {
          let earlierParamUsed = false
          for (let j = 0; j < i; j++) {
            const earlierParam = params.namedChild(j)
            if (!earlierParam) continue
            if (earlierParam.type === 'object_pattern' || earlierParam.type === 'array_pattern' || earlierParam.type === 'rest_parameter') {
              earlierParamUsed = true
              break
            }
            let earlierName: string | null = null
            if (earlierParam.type === 'identifier') earlierName = earlierParam.text
            else if (earlierParam.type === 'required_parameter' || earlierParam.type === 'optional_parameter') {
              const nameNode = earlierParam.childForFieldName('pattern') ?? earlierParam.namedChildren[0]
              if (nameNode?.type === 'identifier') earlierName = nameNode.text
            }
            if (earlierName && !earlierName.startsWith('_')) {
              const earlierRe = buildIdentRegex(earlierName)
              if (earlierRe.test(bodyContent)) {
                earlierParamUsed = true
                break
              }
            }
          }
          if (earlierParamUsed) continue
        }

        return makeViolation(
          this.ruleKey, param, filePath, 'low',
          `Unused parameter \`${paramName}\``,
          `Parameter \`${paramName}\` is never used in the function body. Remove it or prefix with \`_\` if intentional.`,
          sourceCode,
          `Remove unused parameter \`${paramName}\` or rename to \`_${paramName}\`.`,
        )
      }
    }
    return null
  },
}
