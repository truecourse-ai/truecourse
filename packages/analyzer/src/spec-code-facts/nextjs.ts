import ts from 'typescript'
import { isAuthName } from './auth.js'
import { EXTRACTORS } from './metadata.js'
import { nextjsProjectRootFor, sourceFileWithinProjectRoot } from './project-context.js'
import type { CodeFactProjectContext, SourceUnit } from './types.js'
import {
  calleeParts,
  expressionName,
  pushFact,
  rangeOf,
  stringLiteralValue,
  textOfName,
} from './utils.js'

const SOURCE_EXTENSION = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/
const ROUTE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const NEXT_AUTH_CALLS = new Set([
  'auth',
  'clerkmiddleware',
  'getsession',
  'getserversession',
  'gettoken',
  'currentuser',
  'currentuserid',
  'protect',
])

interface NextRoute {
  path: string
  router: 'app' | 'pages'
}

interface FunctionBinding {
  node: ts.Node
  body: ts.Node
  requestNames: string[]
}

interface HandlerSection {
  method: string
  node: ts.Node
  body: ts.Node
  requestNames: string[]
}

interface ApiValidationField {
  name: string
  required?: boolean
  format?: string
  failureStatus?: number
  source: 'manual-guard' | 'zod'
}

interface ApiMutationField {
  operation: 'insert' | 'update'
  entity?: string
  field: string
}

interface ApiRecordMutation {
  operation: 'delete'
  entity?: string
}

function stripSourceExtension(fileName: string): string {
  return fileName.replace(SOURCE_EXTENSION, '')
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
}

function isRouteGroup(segment: string): boolean {
  return segment.startsWith('(') && segment.endsWith(')')
}

function normalizeNextSegment(segment: string): string {
  if (segment.startsWith('[[...') && segment.endsWith(']]')) return `:${segment.slice(5, -2)}*`
  if (segment.startsWith('[...') && segment.endsWith(']')) return `:${segment.slice(4, -1)}*`
  if (segment.startsWith('[') && segment.endsWith(']')) return `:${segment.slice(1, -1)}`
  return segment
}

function visibleAppSegments(segments: string[]): string[] | null {
  const visible: string[] = []
  for (const segment of segments) {
    if (isRouteGroup(segment) || segment.startsWith('@')) continue
    if (segment.startsWith('_')) return null
    visible.push(normalizeNextSegment(segment))
  }
  return visible
}

function visiblePagesSegments(segments: string[]): string[] | null {
  const visible: string[] = []
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    if (segment.startsWith('_')) return null
    if (segment === 'index' && index === segments.length - 1) continue
    visible.push(normalizeNextSegment(segment))
  }
  return visible
}

function routePath(segments: string[]): string {
  if (segments.length === 0) return '/'
  return `/${segments.join('/')}`.replace(/\/+/g, '/')
}

function nextDirectoryIndex(parts: string[], name: 'app' | 'pages'): number {
  if (parts[0] === name) return 0
  if (parts[0] === 'src' && parts[1] === name) return 1
  return -1
}

function appRoute(sourceFile: string): NextRoute | null {
  const parts = sourceFile.split('/').filter(Boolean)
  const fileName = parts.at(-1)
  if (!fileName || stripSourceExtension(fileName) !== 'route') return null

  const appIndex = nextDirectoryIndex(parts, 'app')
  if (appIndex === -1) return null

  const visible = visibleAppSegments(parts.slice(appIndex + 1, -1))
  if (!visible) return null
  return { path: routePath(visible), router: 'app' }
}

function appPageRoute(sourceFile: string): NextRoute | null {
  const parts = sourceFile.split('/').filter(Boolean)
  const fileName = parts.at(-1)
  if (!fileName || stripSourceExtension(fileName) !== 'page') return null

  const appIndex = nextDirectoryIndex(parts, 'app')
  if (appIndex === -1) return null

  const visible = visibleAppSegments(parts.slice(appIndex + 1, -1))
  if (!visible) return null
  return { path: routePath(visible), router: 'app' }
}

function pagesSegments(sourceFile: string): string[] | null {
  const parts = sourceFile.split('/').filter(Boolean)
  const pagesIndex = nextDirectoryIndex(parts, 'pages')
  if (pagesIndex === -1 || pagesIndex === parts.length - 1) return null

  const routeParts = parts.slice(pagesIndex + 1)
  const last = routeParts.at(-1)
  if (!last) return null
  routeParts[routeParts.length - 1] = stripSourceExtension(last)
  return routeParts
}

function pagesApiRoute(sourceFile: string): NextRoute | null {
  const segments = pagesSegments(sourceFile)
  if (!segments || segments[0] !== 'api') return null
  const visible = visiblePagesSegments(segments)
  if (!visible) return null
  return { path: routePath(visible), router: 'pages' }
}

function pagesUiRoute(sourceFile: string): NextRoute | null {
  const segments = pagesSegments(sourceFile)
  if (!segments || segments[0] === 'api') return null
  const visible = visiblePagesSegments(segments)
  if (!visible) return null
  return { path: routePath(visible), router: 'pages' }
}

function requestNamesFromParams(params: ts.NodeArray<ts.ParameterDeclaration>): string[] {
  const first = params[0]
  if (first && ts.isIdentifier(first.name)) return [first.name.text]
  return ['request', 'req']
}

function functionBinding(node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction): FunctionBinding | null {
  if (!node.body) return null
  return {
    node,
    body: node.body,
    requestNames: requestNamesFromParams(node.parameters),
  }
}

function bindingFromInitializer(node: ts.Expression | undefined): FunctionBinding | null {
  const expression = unwrapExpression(node)
  if (!expression) return null
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return functionBinding(expression)
  return null
}

function collectFunctionBindings(unit: SourceUnit): Map<string, FunctionBinding> {
  const bindings = new Map<string, FunctionBinding>()
  for (const statement of unit.ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const binding = functionBinding(statement)
      if (binding) bindings.set(statement.name.text, binding)
    }

    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const binding = bindingFromInitializer(declaration.initializer)
      if (binding) bindings.set(declaration.name.text, binding)
    }
  }
  return bindings
}

function collectAppRouteHandlers(unit: SourceUnit): HandlerSection[] {
  const locals = collectFunctionBindings(unit)
  const handlers: HandlerSection[] = []
  const seen = new Set<string>()

  const add = (method: string, binding: FunctionBinding): void => {
    const normalized = method.toUpperCase()
    if (!ROUTE_METHODS.has(normalized)) return
    const key = `${normalized}:${binding.node.pos}:${binding.node.end}`
    if (seen.has(key)) return
    seen.add(key)
    handlers.push({ method: normalized, node: binding.node, body: binding.body, requestNames: binding.requestNames })
  }

  for (const statement of unit.ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const binding = functionBinding(statement)
      if (binding) add(statement.name.text, binding)
      continue
    }

    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const initializer = unwrapExpression(declaration.initializer)
        const binding = bindingFromInitializer(declaration.initializer)
          ?? (initializer && ts.isIdentifier(initializer) ? locals.get(initializer.text) : undefined)
        if (binding) add(declaration.name.text, binding)
      }
      continue
    }

    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text
        const localName = (element.propertyName ?? element.name).text
        const binding = locals.get(localName)
        if (binding) add(exportedName, binding)
      }
    }
  }

  return handlers
}

function defaultExportBinding(unit: SourceUnit): FunctionBinding | null {
  const locals = collectFunctionBindings(unit)

  for (const statement of unit.ast.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      return functionBinding(statement)
    }

    if (ts.isExportAssignment(statement)) {
      const expression = unwrapExpression(statement.expression)
      if (!expression) continue
      if (ts.isIdentifier(expression)) return locals.get(expression.text) ?? null
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return functionBinding(expression)
    }
  }

  return null
}

function isMethodAccess(node: ts.Expression, requestNames: string[]): boolean {
  const unwrapped = unwrapExpression(node)
  if (!unwrapped || !ts.isPropertyAccessExpression(unwrapped)) return false
  return unwrapped.name.text === 'method'
    && ts.isIdentifier(unwrapped.expression)
    && requestNames.includes(unwrapped.expression.text)
}

function methodFromExpression(node: ts.Expression | undefined): string | undefined {
  const value = stringLiteralValue(unwrapExpression(node))
  if (!value) return undefined
  const method = value.toUpperCase()
  return ROUTE_METHODS.has(method) ? method : undefined
}

function methodsFromCondition(node: ts.Expression, requestNames: string[]): string[] {
  const condition = unwrapExpression(node)
  if (!condition || !ts.isBinaryExpression(condition)) return []
  const operator = condition.operatorToken.kind
  if (
    operator !== ts.SyntaxKind.EqualsEqualsEqualsToken
    && operator !== ts.SyntaxKind.EqualsEqualsToken
  ) {
    return []
  }

  if (isMethodAccess(condition.left, requestNames)) {
    const method = methodFromExpression(condition.right)
    return method ? [method] : []
  }

  if (isMethodAccess(condition.right, requestNames)) {
    const method = methodFromExpression(condition.left)
    return method ? [method] : []
  }

  return []
}

function collectPagesApiSections(binding: FunctionBinding): HandlerSection[] {
  const sections: HandlerSection[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node) && isMethodAccess(node.expression, binding.requestNames)) {
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause)) continue
        const method = methodFromExpression(clause.expression)
        if (method) sections.push({ method, node: clause, body: clause, requestNames: binding.requestNames })
      }
      return
    }

    if (ts.isIfStatement(node)) {
      for (const method of methodsFromCondition(node.expression, binding.requestNames)) {
        sections.push({ method, node, body: node.thenStatement, requestNames: binding.requestNames })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(binding.body)
  return sections.length > 0
    ? sections
    : [{ method: 'ALL', node: binding.node, body: binding.body, requestNames: binding.requestNames }]
}

function unwrapExpression(node: ts.Node | undefined): ts.Node | undefined {
  let current = node
  while (
    current
    && (
      ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isParenthesizedExpression(current)
      || ts.isAwaitExpression(current)
    )
  ) {
    current = current.expression
  }
  return current
}

function numericValue(node: ts.Node | undefined): number | undefined {
  const value = unwrapExpression(node)
  if (!value || !ts.isNumericLiteral(value)) return undefined
  const parsed = Number(value.text)
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : undefined
}

function statusFromOptions(node: ts.Node | undefined): number | undefined {
  const value = unwrapExpression(node)
  if (!value || !ts.isObjectLiteralExpression(value)) return undefined
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property) || textOfName(property.name) !== 'status') continue
    return numericValue(property.initializer)
  }
  return undefined
}

function responseFactoryStatus(node: ts.CallExpression): number | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined
  const parts = calleeParts(node.expression)
  const root = parts[0]
  const method = parts.at(-1)
  if ((root !== 'NextResponse' && root !== 'Response') || (method !== 'json' && method !== 'redirect')) return undefined
  return statusFromOptions(node.arguments[1]) ?? numericValue(node.arguments[1])
}

function collectStatusCodes(node: ts.Node): number[] {
  const codes = new Set<number>()
  const add = (code: number | undefined): void => {
    if (code !== undefined) codes.add(code)
  }

  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child)) {
      if (ts.isPropertyAccessExpression(child.expression)) {
        const method = child.expression.name.text
        if (method === 'status' || method === 'sendStatus' || method === 'writeHead') {
          add(numericValue(child.arguments[0]))
        }
        add(responseFactoryStatus(child))
      }
    }

    if (ts.isNewExpression(child)) {
      const name = calleeParts(child.expression).join('.')
      if (name === 'Response' || name === 'NextResponse') add(statusFromOptions(child.arguments?.[1]))
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return [...codes].sort((a, b) => a - b)
}

function payloadKind(node: ts.Node | undefined, requestNames: string[]): 'json' | 'formData' | undefined {
  const value = unwrapExpression(node)
  if (!value || !ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression)) return undefined
  const method = value.expression.name.text
  if (method !== 'json' && method !== 'formData') return undefined
  const receiver = unwrapExpression(value.expression.expression)
  if (!receiver || !ts.isIdentifier(receiver) || !requestNames.includes(receiver.text)) return undefined
  return method
}

function bindingPatternFields(pattern: ts.ObjectBindingPattern): string[] {
  const fields: string[] = []
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) continue
    const propertyName = textOfName(element.propertyName)
    if (propertyName) {
      fields.push(propertyName)
    } else if (ts.isIdentifier(element.name)) {
      fields.push(element.name.text)
    }
  }
  return fields
}

function bodyFieldFromPropertyAccess(
  node: ts.PropertyAccessExpression,
  requestNames: string[],
  bodyAliases: Set<string>,
): string | undefined {
  if (ts.isIdentifier(node.expression) && bodyAliases.has(node.expression.text)) return node.name.text
  if (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'body'
    && ts.isIdentifier(node.expression.expression)
    && requestNames.includes(node.expression.expression.text)
  ) {
    return node.name.text
  }
  return undefined
}

function bodyFieldFromElementAccess(
  node: ts.ElementAccessExpression,
  requestNames: string[],
  bodyAliases: Set<string>,
): string | undefined {
  const field = stringLiteralValue(unwrapExpression(node.argumentExpression))
  if (!field) return undefined
  if (ts.isIdentifier(node.expression) && bodyAliases.has(node.expression.text)) return field
  if (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'body'
    && ts.isIdentifier(node.expression.expression)
    && requestNames.includes(node.expression.expression.text)
  ) {
    return field
  }
  return undefined
}

function collectRequestFields(node: ts.Node, requestNames: string[]): string[] {
  const fields = new Set<string>()
  const bodyAliases = new Set<string>()
  const formAliases = new Set<string>()

  const addFields = (values: string[]): void => {
    for (const value of values) fields.add(value)
  }

  const visit = (child: ts.Node): void => {
    if (ts.isVariableDeclaration(child)) {
      const kind = payloadKind(child.initializer, requestNames)
      const initializer = unwrapExpression(child.initializer)

      if (ts.isIdentifier(child.name)) {
        if (kind === 'json') bodyAliases.add(child.name.text)
        if (kind === 'formData') formAliases.add(child.name.text)
      }

      if (ts.isObjectBindingPattern(child.name)) {
        if (kind === 'json' || (initializer && ts.isIdentifier(initializer) && bodyAliases.has(initializer.text))) {
          addFields(bindingPatternFields(child.name))
        }
      }
    }

    if (ts.isPropertyAccessExpression(child)) {
      const field = bodyFieldFromPropertyAccess(child, requestNames, bodyAliases)
      if (field) fields.add(field)
    }

    if (ts.isElementAccessExpression(child)) {
      const field = bodyFieldFromElementAccess(child, requestNames, bodyAliases)
      if (field) fields.add(field)
    }

    if (
      ts.isCallExpression(child)
      && ts.isPropertyAccessExpression(child.expression)
      && child.expression.name.text === 'get'
      && ts.isIdentifier(child.expression.expression)
      && formAliases.has(child.expression.expression.text)
    ) {
      const field = stringLiteralValue(unwrapExpression(child.arguments[0]))
      if (field) fields.add(field)
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return [...fields].sort()
}

function isRequestUrlAccess(node: ts.Node | undefined, requestNames: string[]): boolean {
  const value = unwrapExpression(node)
  if (!value || !ts.isPropertyAccessExpression(value)) return false
  if (value.name.text !== 'url') return false
  const receiver = unwrapExpression(value.expression)
  return Boolean(receiver && ts.isIdentifier(receiver) && requestNames.includes(receiver.text))
}

function isSearchParamsExpression(node: ts.Node | undefined, requestNames: string[], aliases: Set<string>): boolean {
  const value = unwrapExpression(node)
  if (!value) return false
  if (ts.isIdentifier(value)) return aliases.has(value.text)

  if (!ts.isPropertyAccessExpression(value) || value.name.text !== 'searchParams') return false
  const receiver = unwrapExpression(value.expression)
  if (!receiver) return false

  if (
    ts.isPropertyAccessExpression(receiver)
    && receiver.name.text === 'nextUrl'
    && ts.isIdentifier(receiver.expression)
    && requestNames.includes(receiver.expression.text)
  ) {
    return true
  }

  if (
    ts.isNewExpression(receiver)
    && expressionName(receiver.expression) === 'URL'
    && isRequestUrlAccess(receiver.arguments?.[0], requestNames)
  ) {
    return true
  }

  return false
}

function collectQueryParams(node: ts.Node, requestNames: string[]): string[] {
  const params = new Set<string>()
  const aliases = new Set<string>()

  const visit = (child: ts.Node): void => {
    if (
      ts.isVariableDeclaration(child)
      && ts.isIdentifier(child.name)
      && isSearchParamsExpression(child.initializer, requestNames, aliases)
    ) {
      aliases.add(child.name.text)
    }

    if (
      ts.isCallExpression(child)
      && ts.isPropertyAccessExpression(child.expression)
      && child.expression.name.text === 'get'
      && isSearchParamsExpression(child.expression.expression, requestNames, aliases)
    ) {
      const name = stringLiteralValue(unwrapExpression(child.arguments[0]))
      if (name) params.add(name)
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return [...params].sort()
}

function firstClientErrorStatus(node: ts.Node): number | undefined {
  return collectStatusCodes(node).find((status) => status >= 400 && status <= 499)
}

function fieldFromBodyPropertyAccess(
  node: ts.PropertyAccessExpression,
  requestNames: string[],
  bodyAliases: Set<string>,
): string | undefined {
  if (ts.isIdentifier(node.expression) && bodyAliases.has(node.expression.text)) return node.name.text
  if (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'body'
    && ts.isIdentifier(node.expression.expression)
    && requestNames.includes(node.expression.expression.text)
  ) {
    return node.name.text
  }
  return undefined
}

function fieldFromBodyElementAccess(
  node: ts.ElementAccessExpression,
  requestNames: string[],
  bodyAliases: Set<string>,
): string | undefined {
  const field = stringLiteralValue(unwrapExpression(node.argumentExpression))
  if (!field) return undefined
  if (ts.isIdentifier(node.expression) && bodyAliases.has(node.expression.text)) return field
  if (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'body'
    && ts.isIdentifier(node.expression.expression)
    && requestNames.includes(node.expression.expression.text)
  ) {
    return field
  }
  return undefined
}

function collectConditionFields(
  node: ts.Node,
  requestNames: string[],
  bodyAliases: Set<string>,
  fieldAliases: Map<string, string>,
): string[] {
  const fields = new Set<string>()

  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) {
      const field = fieldAliases.get(child.text)
      if (field) fields.add(field)
    }

    if (ts.isPropertyAccessExpression(child)) {
      const field = fieldFromBodyPropertyAccess(child, requestNames, bodyAliases)
      if (field) fields.add(field)
    }

    if (ts.isElementAccessExpression(child)) {
      const field = fieldFromBodyElementAccess(child, requestNames, bodyAliases)
      if (field) fields.add(field)
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return [...fields].sort()
}

function bindingPatternFieldAliases(pattern: ts.ObjectBindingPattern): Map<string, string> {
  const fields = new Map<string, string>()
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) continue
    const propertyName = textOfName(element.propertyName)
    if (propertyName && ts.isIdentifier(element.name)) {
      fields.set(element.name.text, propertyName)
    } else if (ts.isIdentifier(element.name)) {
      fields.set(element.name.text, element.name.text)
    }
  }
  return fields
}

function zodObjectSchemaFields(node: ts.Node | undefined): ApiValidationField[] {
  const value = unwrapExpression(node)
  if (!value || !ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression)) return []
  const callee = calleeParts(value.expression).join('.')
  if (callee !== 'z.object' && value.expression.name.text !== 'object') return []

  const shape = unwrapExpression(value.arguments[0])
  if (!shape || !ts.isObjectLiteralExpression(shape)) return []

  const fields: ApiValidationField[] = []
  for (const property of shape.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    const name = ts.isShorthandPropertyAssignment(property) ? property.name.text : textOfName(property.name)
    if (!name) continue
    const source = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
    const sourceText = source.getText().toLowerCase()
    fields.push({
      name,
      required: !/\.(optional|nullish)\s*\(/.test(sourceText),
      ...(sourceText.includes('.url(') ? { format: 'url' } : {}),
      source: 'zod',
    })
  }
  return fields
}

function isSchemaParseCall(node: ts.CallExpression, schemas: Map<string, ApiValidationField[]>): ApiValidationField[] {
  if (!ts.isPropertyAccessExpression(node.expression)) return []
  const method = node.expression.name.text
  if (method !== 'parse' && method !== 'safeParse') return []
  const receiver = unwrapExpression(node.expression.expression)
  if (!receiver || !ts.isIdentifier(receiver)) return []
  return schemas.get(receiver.text) ?? []
}

function collectValidationFields(node: ts.Node, requestNames: string[]): ApiValidationField[] {
  const validations = new Map<string, ApiValidationField>()
  const bodyAliases = new Set<string>()
  const fieldAliases = new Map<string, string>()
  const schemas = new Map<string, ApiValidationField[]>()

  const addValidation = (field: ApiValidationField): void => {
    const key = `${field.name}:${field.required ?? ''}:${field.format ?? ''}:${field.failureStatus ?? ''}:${field.source}`
    validations.set(key, field)
  }

  const visit = (child: ts.Node): void => {
    if (ts.isVariableDeclaration(child)) {
      const kind = payloadKind(child.initializer, requestNames)
      const initializer = unwrapExpression(child.initializer)

      if (ts.isIdentifier(child.name)) {
        if (kind === 'json') bodyAliases.add(child.name.text)
        const schemaFields = zodObjectSchemaFields(initializer)
        if (schemaFields.length > 0) schemas.set(child.name.text, schemaFields)
      }

      if (ts.isObjectBindingPattern(child.name)) {
        if (kind === 'json' || (initializer && ts.isIdentifier(initializer) && bodyAliases.has(initializer.text))) {
          for (const [localName, fieldName] of bindingPatternFieldAliases(child.name)) {
            fieldAliases.set(localName, fieldName)
          }
        }
      }
    }

    if (ts.isIfStatement(child)) {
      const failureStatus = firstClientErrorStatus(child.thenStatement)
      if (failureStatus !== undefined) {
        const conditionText = child.expression.getText().toLowerCase()
        const format = /\burl\.canparse\b|new\s+url\s*\(|\.url\s*\(/i.test(conditionText) ? 'url' : undefined
        for (const name of collectConditionFields(child.expression, requestNames, bodyAliases, fieldAliases)) {
          addValidation({ name, required: true, ...(format ? { format } : {}), failureStatus, source: 'manual-guard' })
        }
      }
    }

    if (ts.isCallExpression(child)) {
      for (const field of isSchemaParseCall(child, schemas)) addValidation(field)
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return [...validations.values()].sort((a, b) => `${a.name}:${a.source}`.localeCompare(`${b.name}:${b.source}`))
}

function collectObjectLiteralFields(node: ts.Node | undefined): string[] {
  const fields = new Set<string>()
  const value = unwrapExpression(node)
  if (!value) return []

  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = textOfName(property.name)
        if (name) fields.add(name)
      } else if (ts.isShorthandPropertyAssignment(property)) {
        fields.add(property.name.text)
      } else if (ts.isSpreadAssignment(property)) {
        for (const field of collectObjectLiteralFields(property.expression)) fields.add(field)
      }
    }
  } else if (ts.isConditionalExpression(value)) {
    for (const field of collectObjectLiteralFields(value.whenTrue)) fields.add(field)
    for (const field of collectObjectLiteralFields(value.whenFalse)) fields.add(field)
  }

  return [...fields].sort()
}

function mutationFactory(node: ts.Node | undefined): { operation: 'insert' | 'update' | 'delete'; entity?: string } | undefined {
  const value = unwrapExpression(node)
  if (!value) return undefined

  if (ts.isCallExpression(value)) {
    if (ts.isPropertyAccessExpression(value.expression)) {
      const method = value.expression.name.text
      if (method === 'insert' || method === 'update' || method === 'delete') {
        const entity = expressionName(value.arguments[0]) ?? stringLiteralValue(unwrapExpression(value.arguments[0]))
        return { operation: method, ...(entity ? { entity } : {}) }
      }
    }
    return mutationFactory(value.expression)
  }

  if (ts.isPropertyAccessExpression(value)) return mutationFactory(value.expression)
  return undefined
}

function collectMutationFacts(node: ts.Node): { fields: ApiMutationField[]; records: ApiRecordMutation[] } {
  const fields = new Map<string, ApiMutationField>()
  const records = new Map<string, ApiRecordMutation>()

  const addField = (field: ApiMutationField): void => {
    fields.set(`${field.operation}:${field.entity ?? ''}:${field.field}`, field)
  }

  const addRecord = (recordMutation: ApiRecordMutation): void => {
    records.set(`${recordMutation.operation}:${recordMutation.entity ?? ''}`, recordMutation)
  }

  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
      const method = child.expression.name.text

      if (method === 'set' || method === 'values') {
        const factory = mutationFactory(child.expression.expression)
        if (factory && (factory.operation === 'update' || factory.operation === 'insert')) {
          for (const field of collectObjectLiteralFields(child.arguments[0])) {
            addField({ operation: factory.operation, ...(factory.entity ? { entity: factory.entity } : {}), field })
          }
        }
      }

      if (method === 'delete') {
        const factory = mutationFactory(child)
        if (factory?.operation === 'delete') addRecord({ operation: 'delete', ...(factory.entity ? { entity: factory.entity } : {}) })
      }
    }

    if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = unwrapExpression(child.left)
      if (left && ts.isPropertyAccessExpression(left)) {
        addField({ operation: 'update', field: left.name.text })
      }
      if (left && ts.isElementAccessExpression(left)) {
        const field = stringLiteralValue(unwrapExpression(left.argumentExpression))
        if (field) addField({ operation: 'update', field })
      }
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return {
    fields: [...fields.values()].sort((a, b) => `${a.operation}:${a.entity ?? ''}:${a.field}`.localeCompare(`${b.operation}:${b.entity ?? ''}:${b.field}`)),
    records: [...records.values()].sort((a, b) => `${a.operation}:${a.entity ?? ''}`.localeCompare(`${b.operation}:${b.entity ?? ''}`)),
  }
}

function authSource(name: string): string {
  const normalized = name.toLowerCase()
  if (normalized.includes('clerkmiddleware')) return 'middleware'
  if (normalized.includes('role')) return 'role-check'
  if (normalized.includes('permission')) return 'permission-check'
  if (normalized.includes('session') || normalized.includes('token')) return 'session-check'
  if (normalized.includes('currentuser')) return 'user-check'
  return 'guard-call'
}

function authHeaderSignal(node: ts.CallExpression, unit: SourceUnit): { signal: string; source: string } | undefined {
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'get') return undefined
  const key = stringLiteralValue(unwrapExpression(node.arguments[0]))?.toLowerCase()
  if (!key || !/(authorization|session|token|jwt|cookie)/i.test(key)) return undefined

  const receiver = unwrapExpression(node.expression.expression)
  if (!receiver) return undefined
  if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'headers') {
    return { signal: node.getText(unit.ast), source: 'header-check' }
  }

  if (ts.isCallExpression(receiver) && expressionName(receiver.expression) === 'headers') {
    return { signal: node.getText(unit.ast), source: 'header-check' }
  }

  if (ts.isCallExpression(receiver) && expressionName(receiver.expression) === 'cookies') {
    return { signal: node.getText(unit.ast), source: 'cookie-check' }
  }

  return undefined
}

function emitAuthFacts(unit: SourceUnit, node: ts.Node, route: string): void {
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child)) {
      const headerSignal = authHeaderSignal(child, unit)
      if (headerSignal) {
        pushFact(
          unit.facts,
          unit.sourceFile,
          rangeOf(unit.ast, child),
          'auth.signal',
          'auth.detected',
          { ...headerSignal, route },
          EXTRACTORS.nextjs,
        )
      }

      const name = expressionName(child.expression)
      if (name && (isAuthName(name) || NEXT_AUTH_CALLS.has(name.toLowerCase()))) {
        const signal = child.getText(unit.ast)
        const args = child.arguments.map((arg) => arg.getText(unit.ast))
        pushFact(
          unit.facts,
          unit.sourceFile,
          rangeOf(unit.ast, child),
          'auth.signal',
          'auth.detected',
          {
            signal,
            source: authSource(name),
            route,
            roles: args.filter((arg) => /admin|owner|user|member|manager|editor|viewer/i.test(arg)).map((arg) => arg.replace(/^['"]|['"]$/g, '')),
            permissions: args.filter((arg) => /[.:_-]/.test(arg)).map((arg) => arg.replace(/^['"]|['"]$/g, '')),
            adminOnly: /admin/i.test(signal),
            ownershipCheck: /owner|userId|canAccess|belongsTo|self/i.test(signal),
          },
          EXTRACTORS.nextjs,
        )
      }
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
}

function emitApiFacts(unit: SourceUnit, route: NextRoute, section: HandlerSection): void {
  pushFact(
    unit.facts,
    unit.sourceFile,
    rangeOf(unit.ast, section.node),
    'api.route',
    'route.exists',
    {
      method: section.method,
      path: route.path,
      handlerName: section.method,
      middlewares: [],
      framework: 'nextjs',
      router: route.router,
    },
    EXTRACTORS.nextjs,
  )

  for (const statusCode of collectStatusCodes(section.body)) {
    pushFact(
      unit.facts,
      unit.sourceFile,
      rangeOf(unit.ast, section.node),
      'api.response.status',
      'status.returned',
      { method: section.method, path: route.path, statusCode },
      EXTRACTORS.nextjs,
    )
  }

  for (const field of collectRequestFields(section.body, section.requestNames)) {
    pushFact(
      unit.facts,
      unit.sourceFile,
      rangeOf(unit.ast, section.node),
      'api.request.field',
      'field.used',
      { method: section.method, path: route.path, name: field },
      EXTRACTORS.nextjs,
    )
  }

  for (const name of collectQueryParams(section.body, section.requestNames)) {
    pushFact(
      unit.facts,
      unit.sourceFile,
      rangeOf(unit.ast, section.node),
      'api.query.param',
      'param.used',
      { method: section.method, path: route.path, name },
      EXTRACTORS.nextjs,
    )
  }

  for (const validation of collectValidationFields(section.body, section.requestNames)) {
    pushFact(
      unit.facts,
      unit.sourceFile,
      rangeOf(unit.ast, section.node),
      'api.validation.field',
      'field.validated',
      {
        method: section.method,
        path: route.path,
        name: validation.name,
        ...(validation.required !== undefined ? { required: validation.required } : {}),
        ...(validation.format ? { format: validation.format } : {}),
        ...(validation.failureStatus ? { failureStatus: validation.failureStatus } : {}),
        source: validation.source,
      },
      EXTRACTORS.nextjs,
    )
  }

  const mutations = collectMutationFacts(section.body)
  for (const mutation of mutations.fields) {
    pushFact(
      unit.facts,
      unit.sourceFile,
      rangeOf(unit.ast, section.node),
      'api.mutation.field',
      'field.set',
      {
        method: section.method,
        path: route.path,
        operation: mutation.operation,
        ...(mutation.entity ? { entity: mutation.entity } : {}),
        field: mutation.field,
      },
      EXTRACTORS.nextjs,
    )
  }

  for (const mutation of mutations.records) {
    pushFact(
      unit.facts,
      unit.sourceFile,
      rangeOf(unit.ast, section.node),
      'api.mutation.record',
      'record.deleted',
      {
        method: section.method,
        path: route.path,
        operation: mutation.operation,
        ...(mutation.entity ? { entity: mutation.entity } : {}),
      },
      EXTRACTORS.nextjs,
    )
  }

  emitAuthFacts(unit, section.body, route.path)
}

function defaultExportComponent(unit: SourceUnit): { name?: string; node: ts.Node } {
  const locals = new Map<string, ts.Node>()
  for (const statement of unit.ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) locals.set(statement.name.text, statement)
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) locals.set(declaration.name.text, declaration)
    }
  }

  for (const statement of unit.ast.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      && hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      return { ...(statement.name ? { name: statement.name.text } : {}), node: statement }
    }

    if (ts.isExportAssignment(statement)) {
      const expression = unwrapExpression(statement.expression)
      if (!expression) return { node: statement }
      if (ts.isIdentifier(expression)) return { name: expression.text, node: locals.get(expression.text) ?? statement }
      return { node: statement }
    }
  }

  return { node: unit.ast.statements[0] ?? unit.ast }
}

function emitUiRouteFact(unit: SourceUnit, route: NextRoute): void {
  const component = defaultExportComponent(unit)
  pushFact(
    unit.facts,
    unit.sourceFile,
    rangeOf(unit.ast, component.node),
    'ui.route',
    'route.exists',
    {
      path: route.path,
      ...(component.name ? { componentName: component.name } : {}),
      framework: 'nextjs',
      router: route.router,
    },
    EXTRACTORS.nextjs,
  )
}

export function extractNextjsFacts(unit: SourceUnit, context: CodeFactProjectContext): void {
  const projectRoot = nextjsProjectRootFor(unit.sourceFile, context)
  if (projectRoot === undefined) return
  const routeSourceFile = sourceFileWithinProjectRoot(unit.sourceFile, projectRoot)

  const appApi = appRoute(routeSourceFile)
  if (appApi) {
    for (const handler of collectAppRouteHandlers(unit)) emitApiFacts(unit, appApi, handler)
  }

  const pagesApi = pagesApiRoute(routeSourceFile)
  if (pagesApi) {
    const binding = defaultExportBinding(unit)
    if (binding) {
      for (const section of collectPagesApiSections(binding)) emitApiFacts(unit, pagesApi, section)
    }
  }

  const uiRoute = appPageRoute(routeSourceFile) ?? pagesUiRoute(routeSourceFile)
  if (uiRoute) emitUiRouteFact(unit, uiRoute)
}
