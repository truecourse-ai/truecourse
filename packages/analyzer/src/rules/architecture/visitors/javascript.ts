/**
 * Architecture domain JS/TS code-level visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPRESS_ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'use', 'all'])

function isRouteHandler(node: SyntaxNode): boolean {
  const fn = node.childForFieldName('function')
  if (!fn || fn.type !== 'member_expression') return false

  const prop = fn.childForFieldName('property')
  if (!prop || !EXPRESS_ROUTE_METHODS.has(prop.text)) return false

  const obj = fn.childForFieldName('object')
  if (!obj) return false
  const objName = obj.text
  return objName === 'app' || objName === 'router' || objName === 'route'
}

function getHandlerFromRouteCall(node: SyntaxNode): SyntaxNode | null {
  const args = node.childForFieldName('arguments')
  if (!args) return null
  const lastArg = args.namedChildren[args.namedChildren.length - 1]
  if (!lastArg) return null
  if (lastArg.type === 'arrow_function' || lastArg.type === 'function') {
    return lastArg
  }
  return null
}

// ---------------------------------------------------------------------------
// duplicate-import — Same module imported multiple times
// ---------------------------------------------------------------------------

export const duplicateImportVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/duplicate-import',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const imports = node.namedChildren.filter((c) => c.type === 'import_statement')
    const sourceMap = new Map<string, SyntaxNode>()

    for (const imp of imports) {
      const source = imp.childForFieldName('source')
      if (!source) continue
      const moduleName = source.text.replace(/['"]/g, '')

      if (sourceMap.has(moduleName)) {
        return makeViolation(
          this.ruleKey, imp, filePath, 'low',
          'Duplicate import',
          `Module '${moduleName}' is imported more than once. Consolidate into a single import.`,
          sourceCode,
          `Merge the imports from '${moduleName}' into a single import statement.`,
        )
      }
      sourceMap.set(moduleName, imp)
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unused-import — Import never referenced in the file
// ---------------------------------------------------------------------------

export const unusedImportVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/unused-import',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    // Skip type-only imports (used for TS type checking only)
    if (node.text.includes('import type')) return null

    const importClause = node.namedChildren.find((c) => c.type === 'import_clause')
    if (!importClause) return null

    // Get all imported names
    const names: string[] = []

    for (const child of importClause.namedChildren) {
      if (child.type === 'identifier') {
        names.push(child.text)
      } else if (child.type === 'named_imports') {
        for (const spec of child.namedChildren) {
          if (spec.type === 'import_specifier') {
            const alias = spec.childForFieldName('alias')
            const name = alias ?? spec.childForFieldName('name')
            if (name) names.push(name.text)
          }
        }
      } else if (child.type === 'namespace_import') {
        const name = child.namedChildren.find((c) => c.type === 'identifier')
        if (name) names.push(name.text)
      }
    }

    // Check if each imported name appears elsewhere in the file
    // Remove the import line itself from the search
    const importLineStart = node.startPosition.row
    const importLineEnd = node.endPosition.row
    const lines = sourceCode.split('\n')
    const codeWithoutImport = [
      ...lines.slice(0, importLineStart),
      ...lines.slice(importLineEnd + 1),
    ].join('\n')

    for (const name of names) {
      // Check if name appears in the rest of the code (as a word boundary)
      const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      if (!regex.test(codeWithoutImport)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          `Unused import: ${name}`,
          `Imported '${name}' is not referenced anywhere in the file.`,
          sourceCode,
          `Remove the unused import of '${name}'.`,
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// declarations-in-global-scope — Variables/functions declared globally
// ---------------------------------------------------------------------------

export const declarationsInGlobalScopeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/declarations-in-global-scope',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['lexical_declaration'],
  visit(node, filePath, sourceCode) {
    // Only flag if directly under program (global scope)
    if (node.parent?.type !== 'program') return null

    // Skip: const exports, imports, type declarations
    const text = node.text
    if (text.includes('export')) return null

    // Skip simple constants (UPPER_CASE) — those are intentional
    const declarator = node.namedChildren.find((c) => c.type === 'variable_declarator')
    if (declarator) {
      const name = declarator.childForFieldName('name')
      if (name && /^[A-Z_][A-Z_0-9]*$/.test(name.text)) return null
    }

    // Skip if the value is a require() call or import
    if (text.includes('require(')) return null

    // Skip if it's a function/class expression assigned to a variable (common pattern)
    if (declarator) {
      const value = declarator.childForFieldName('value')
      if (value && (value.type === 'arrow_function' || value.type === 'function' || value.type === 'class')) return null
    }

    // Flag mutable global state
    const keyword = node.children[0]
    if (keyword?.text === 'let') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Mutable variable in global scope',
        'Mutable global variable (let) creates shared state that is hard to test and reason about.',
        sourceCode,
        'Move this variable into a function, class, or module scope.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// missing-input-validation — Route handler without input validation
// ---------------------------------------------------------------------------

export const missingInputValidationVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-input-validation',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isRouteHandler(node)) return null

    const handler = getHandlerFromRouteCall(node)
    if (!handler) return null

    const body = handler.childForFieldName('body')
    if (!body) return null

    const bodyText = body.text

    // Check for input validation patterns
    const hasValidation =
      bodyText.includes('.parse(') ||
      bodyText.includes('.validate(') ||
      bodyText.includes('.safeParse(') ||
      bodyText.includes('Joi.') ||
      bodyText.includes('yup.') ||
      bodyText.includes('zod') ||
      bodyText.includes('ajv') ||
      bodyText.includes('checkSchema') ||
      bodyText.includes('validationResult')

    if (hasValidation) return null

    // Only flag POST/PUT/PATCH handlers that likely receive body data
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (!prop) return null
    if (prop.text !== 'post' && prop.text !== 'put' && prop.text !== 'patch') return null

    // Check if handler accesses req.body
    if (!bodyText.includes('req.body') && !bodyText.includes('request.body')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Route handler without input validation',
      `${prop.text.toUpperCase()} handler accesses request body without validation. Unvalidated input is a security and reliability risk.`,
      sourceCode,
      'Add input validation using Zod, Joi, or a similar validation library.',
    )
  },
}

// ---------------------------------------------------------------------------
// missing-pagination-endpoint — List endpoint without pagination
// ---------------------------------------------------------------------------

export const missingPaginationEndpointVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-pagination-endpoint',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isRouteHandler(node)) return null

    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'get') return null

    const handler = getHandlerFromRouteCall(node)
    if (!handler) return null

    const body = handler.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    // Check if this looks like a list endpoint (returns array, findAll, findMany, etc.)
    const isListEndpoint =
      bodyText.includes('findAll') ||
      bodyText.includes('findMany') ||
      bodyText.includes('find({') ||
      bodyText.includes('.select(') ||
      bodyText.includes('SELECT *') ||
      bodyText.includes('SELECT *')

    if (!isListEndpoint) return null

    // Check for pagination
    const hasPagination =
      bodyText.includes('limit') ||
      bodyText.includes('offset') ||
      bodyText.includes('page') ||
      bodyText.includes('cursor') ||
      bodyText.includes('skip') ||
      bodyText.includes('take')

    if (hasPagination) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'List endpoint without pagination',
      'GET handler returns a list without pagination. This can return unbounded data.',
      sourceCode,
      'Add pagination (limit/offset or cursor-based) to the list endpoint.',
    )
  },
}

// ---------------------------------------------------------------------------
// missing-error-status-code — Catch block sending 200 on error
// ---------------------------------------------------------------------------

export const missingErrorStatusCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-error-status-code',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Check if this catch is inside a route handler
    if (!filePath.match(/(?:route|controller|handler|api|server)/i)) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    // Check if body sends a response
    if (!bodyText.includes('res.json(') && !bodyText.includes('res.send(')) return null

    // Check if status is set
    if (bodyText.includes('.status(') || bodyText.includes('.sendStatus(')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Catch block sends response without error status code',
      'Catch block sends a response without setting an error status code (e.g., 500). Client will receive 200.',
      sourceCode,
      'Add res.status(500) before res.json() in the catch block.',
    )
  },
}

// ---------------------------------------------------------------------------
// route-without-auth-middleware — Route without auth middleware
// ---------------------------------------------------------------------------

export const routeWithoutAuthMiddlewareVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/route-without-auth-middleware',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isRouteHandler(node)) return null

    // Skip health check, login, register, public endpoints
    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (firstArg) {
      const path = firstArg.text.replace(/['"]/g, '')
      const publicPaths = ['/health', '/login', '/register', '/signup', '/auth', '/webhook', '/public']
      if (publicPaths.some((p) => path.includes(p))) return null
    }

    // Check if there's a middleware argument (more than just path + handler)
    const allArgs = args.namedChildren
    if (allArgs.length <= 2) {
      // Only path + handler, no middleware
      // Check if the file has global auth middleware applied
      const fileText = sourceCode
      if (
        fileText.includes('authenticate') ||
        fileText.includes('authMiddleware') ||
        fileText.includes('requireAuth') ||
        fileText.includes('isAuthenticated') ||
        fileText.includes('passport.')
      ) {
        return null
      }

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Route without auth middleware',
        'Route handler has no authentication middleware. Add auth middleware or mark as public.',
        sourceCode,
        'Add auth middleware: app.get("/path", authMiddleware, handler)',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// missing-rate-limiting — API without rate limiting
// ---------------------------------------------------------------------------

export const missingRateLimitingVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-rate-limiting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check files that define routes
    if (!filePath.match(/(?:route|controller|api|server|app)/i)) return null

    const text = sourceCode
    const hasRoutes = EXPRESS_ROUTE_METHODS.has('get') && (
      text.includes('app.get(') || text.includes('router.get(') ||
      text.includes('app.post(') || text.includes('router.post(')
    )
    if (!hasRoutes) return null

    const hasRateLimiting =
      text.includes('rateLimit') ||
      text.includes('rate-limit') ||
      text.includes('rateLimiter') ||
      text.includes('RateLimiter') ||
      text.includes('throttle') ||
      text.includes('slowDown')

    if (hasRateLimiting) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'API without rate limiting',
      'Route file has no rate limiting middleware. APIs should be rate-limited to prevent abuse.',
      sourceCode,
      'Add rate limiting: app.use(rateLimit({ windowMs: 15*60*1000, max: 100 }))',
    )
  },
}

// ---------------------------------------------------------------------------
// missing-request-body-size-limit — No body size limit
// ---------------------------------------------------------------------------

export const missingRequestBodySizeLimitVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-request-body-size-limit',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check main app/server files
    const lowerPath = filePath.toLowerCase()
    if (!lowerPath.includes('app.') && !lowerPath.includes('server.')) return null

    const text = sourceCode

    // Check if express.json() or bodyParser is used
    if (!text.includes('express.json(') && !text.includes('bodyParser.json(') && !text.includes('express.urlencoded(')) {
      return null
    }

    // Check if limit is set
    if (text.includes("limit:") || text.includes("limit':") || text.includes('limit":')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'No request body size limit',
      "express.json() or bodyParser.json() used without a 'limit' option. Large payloads may cause OOM.",
      sourceCode,
      "Add a limit: express.json({ limit: '10kb' })",
    )
  },
}

// ---------------------------------------------------------------------------
// raw-error-in-response — Error stack/message in API response
// ---------------------------------------------------------------------------

export const rawErrorInResponseVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/raw-error-in-response',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    if (!filePath.match(/(?:route|controller|handler|api|server)/i)) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    const param = node.childForFieldName('parameter')
    if (!param) return null
    const errName = param.text.replace(/:.+/, '').trim()

    // Check if error details are sent in response
    if (
      bodyText.includes(`${errName}.stack`) ||
      bodyText.includes(`${errName}.message`) ||
      // res.json(err) or res.send(err)
      bodyText.match(new RegExp(`res\\.(?:json|send)\\(${errName}\\)`))
    ) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Error details exposed in API response',
        `Error details (stack, message) from '${errName}' sent to client. This leaks implementation details.`,
        sourceCode,
        'Send a generic error message to the client and log the full error server-side.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// type-assertion-overuse — Heavy use of `as Type`
// ---------------------------------------------------------------------------

export const typeAssertionOveruseVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/type-assertion-overuse',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['as_expression'],
  visit(node, filePath, sourceCode) {
    // Count total `as` expressions in the file (heuristic: flag if this file has many)
    // To avoid O(n^2), we only flag `as any` and `as unknown` which are the most problematic
    const typeNode = node.namedChildren[node.namedChildren.length - 1]
    if (!typeNode) return null

    const typeName = typeNode.text
    if (typeName === 'any') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Type assertion to any',
        "'as any' bypasses TypeScript's type system entirely. Use proper type narrowing instead.",
        sourceCode,
        'Use type guards, generics, or proper type narrowing instead of "as any".',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// barrel-file-re-export-all — index.ts re-exporting everything
// ---------------------------------------------------------------------------

export const barrelFileReExportAllVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/barrel-file-re-export-all',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    // Only check index files
    const lowerPath = filePath.toLowerCase()
    if (!lowerPath.endsWith('/index.ts') && !lowerPath.endsWith('/index.js') && !lowerPath.endsWith('/index.tsx')) {
      return null
    }

    // Look for export * from '...'
    const text = node.text
    if (text.startsWith('export *') && text.includes('from')) {
      // Count how many export * statements in this file
      const program = node.parent
      if (!program) return null

      const reExportCount = program.namedChildren.filter((c) =>
        c.type === 'export_statement' && c.text.startsWith('export *'),
      ).length

      if (reExportCount > 5) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Barrel file with many re-exports',
          `index file has ${reExportCount} 'export *' statements. Barrel files can slow down bundlers and TypeScript.`,
          sourceCode,
          'Use named re-exports or import directly from the source module.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// Export all visitors
// ---------------------------------------------------------------------------

export const ARCHITECTURE_JS_VISITORS: CodeRuleVisitor[] = [
  duplicateImportVisitor,
  unusedImportVisitor,
  declarationsInGlobalScopeVisitor,
  missingInputValidationVisitor,
  missingPaginationEndpointVisitor,
  missingErrorStatusCodeVisitor,
  routeWithoutAuthMiddlewareVisitor,
  missingRateLimitingVisitor,
  missingRequestBodySizeLimitVisitor,
  rawErrorInResponseVisitor,
  typeAssertionOveruseVisitor,
  barrelFileReExportAllVisitor,
]
