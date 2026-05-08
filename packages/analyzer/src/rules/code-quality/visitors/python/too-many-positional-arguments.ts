import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const MAX_POSITIONAL = 5

/**
 * FastAPI / Starlette parameter-source markers. Any parameter
 * whose annotation contains an `Annotated[..., Query/Body/...]`
 * marker is supplied BY NAME by the framework, even though
 * Python sees it as positional. Fan-out is dictated by the
 * route shape, not by an over-broad function signature.
 */
const FASTAPI_ANNOTATED_PARAM_MARKERS = /\b(?:Query|Body|Path|Header|Cookie|Form|File|Depends|Security)\s*\(/

const FASTAPI_ROUTE_DECORATORS = new Set([
  'get', 'post', 'put', 'delete', 'patch', 'head', 'options',
  'websocket', 'api_route',
])

function hasFastApiRouteDecorator(funcNode: import('web-tree-sitter').Node): boolean {
  const parent = funcNode.parent
  if (!parent || parent.type !== 'decorated_definition') return false
  for (const child of parent.children) {
    if (child.type !== 'decorator') continue
    const text = child.text
    // Match `@router.get(...)`, `@app.post(...)`, `@<x>.api_route(...)` etc.
    const m = text.match(/@\s*\w+\s*\.\s*(\w+)\s*\(/)
    if (m && FASTAPI_ROUTE_DECORATORS.has(m[1])) return true
  }
  return false
}

export const pythonTooManyPositionalArgumentsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-positional-arguments',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Skip FastAPI route handlers — params are bound by name.
    if (hasFastApiRouteDecorator(node)) return null
    // Skip any function whose params include Annotated[...] markers
    // (covers callsites where the route decorator is `app.add_api_route`
    // / `Mount(...)` / etc. that don't appear above the def).
    {
      let sawFastApiAnnotated = false
      for (const param of params.namedChildren) {
        if (FASTAPI_ANNOTATED_PARAM_MARKERS.test(param.text)) {
          sawFastApiAnnotated = true
          break
        }
      }
      if (sawFastApiAnnotated) return null
    }

    let positionalCount = 0
    for (const param of params.namedChildren) {
      const t = param.type
      // Count regular parameters (not *args, **kwargs, keyword-only)
      if (t === 'identifier') {
        positionalCount++
      } else if (t === 'default_parameter') {
        // Still positional with default
        positionalCount++
      } else if (t === 'typed_parameter' || t === 'typed_default_parameter') {
        positionalCount++
      } else if (t === 'list_splat_pattern' || t === 'dictionary_splat_pattern') {
        // *args, **kwargs — stop counting positional
        break
      }
    }

    // Skip self/cls
    const firstParam = params.namedChildren[0]
    if (firstParam && (firstParam.text === 'self' || firstParam.text === 'cls')) {
      positionalCount--
    }

    if (positionalCount > MAX_POSITIONAL) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `Too many positional arguments (${positionalCount})`,
        `Function \`${name}\` has ${positionalCount} positional arguments — use keyword arguments or a dataclass.`,
        sourceCode,
        'Reduce positional arguments by using keyword-only arguments or grouping into a dataclass.',
      )
    }
    return null
  },
}
