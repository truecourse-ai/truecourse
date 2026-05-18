import ts from 'typescript'
import { jsxAttributeValue, jsxAttrs, jsxTagName } from './jsx-helpers.js'
import { EXTRACTORS } from './metadata.js'
import type { StaticValueResolver } from './static-values.js'
import type { SourceUnit } from './types.js'
import { joinRoutePath, pushFact, rangeOf, stringLiteralValue, textOfName } from './utils.js'

interface ReactRouterBindingEvidence {
  routeComponentNames: Set<string>
  createBrowserRouterNames: Set<string>
  namespaceNames: Set<string>
}

function isReactRouterModule(source: string): boolean {
  return source === 'react-router' || source === 'react-router-dom'
}

function collectReactRouterBindingEvidence(unit: SourceUnit): ReactRouterBindingEvidence {
  const evidence: ReactRouterBindingEvidence = {
    routeComponentNames: new Set(),
    createBrowserRouterNames: new Set(),
    namespaceNames: new Set(),
  }

  for (const statement of unit.ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!isReactRouterModule(statement.moduleSpecifier.text)) continue

    const clause = statement.importClause
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      evidence.namespaceNames.add(clause.namedBindings.name.text)
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const importedName = (element.propertyName ?? element.name).text
        if (importedName === 'Route') evidence.routeComponentNames.add(element.name.text)
        if (importedName === 'createBrowserRouter') evidence.createBrowserRouterNames.add(element.name.text)
      }
    }
  }

  return evidence
}

function isRouteTag(tagName: string, evidence: ReactRouterBindingEvidence): boolean {
  if (evidence.routeComponentNames.has(tagName)) return true
  const [namespace, member] = tagName.split('.')
  return member === 'Route' && Boolean(namespace && evidence.namespaceNames.has(namespace))
}

function isCreateBrowserRouterCall(node: ts.Expression, evidence: ReactRouterBindingEvidence): boolean {
  if (ts.isIdentifier(node)) return evidence.createBrowserRouterNames.has(node.text)
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'createBrowserRouter' && ts.isIdentifier(node.expression)) {
    return evidence.namespaceNames.has(node.expression.text)
  }
  return false
}

function routePathFromJsxAttr(
  unit: SourceUnit,
  attrs: Map<string, ts.JsxAttribute>,
  resolver?: StaticValueResolver,
): { path?: string; index?: boolean } {
  const resolve = (node: ts.Node) => resolver?.resolveString(unit, node)
  const path = jsxAttributeValue(attrs.get('path'), resolve)
  const index = jsxAttributeValue(attrs.get('index'), resolve)
  return {
    ...(typeof path === 'string' ? { path } : {}),
    ...(index === true || index === 'true' ? { index: true } : {}),
  }
}

function componentNameFromElementAttr(attr: ts.JsxAttribute | undefined): string | undefined {
  if (!attr?.initializer || !ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) return undefined
  const expression = attr.initializer.expression
  if (ts.isJsxElement(expression)) return jsxTagName(expression.openingElement)
  if (ts.isJsxSelfClosingElement(expression)) return jsxTagName(expression)
  if (ts.isIdentifier(expression)) return expression.text
  return undefined
}

export function extractReactRouteFacts(unit: SourceUnit, resolver?: StaticValueResolver): void {
  const bindingEvidence = collectReactRouterBindingEvidence(unit)
  if (
    bindingEvidence.routeComponentNames.size === 0
    && bindingEvidence.createBrowserRouterNames.size === 0
    && bindingEvidence.namespaceNames.size === 0
  ) {
    return
  }

  const emit = (node: ts.Node, value: Record<string, unknown>): void => {
    pushFact(unit.facts, unit.sourceFile, rangeOf(unit.ast, node), 'ui.route', 'route.exists', value, EXTRACTORS.react)
  }

  const visitJsxRoutes = (node: ts.Node, parentPath = ''): void => {
    if (ts.isJsxElement(node) && isRouteTag(jsxTagName(node.openingElement), bindingEvidence)) {
      const attrs = jsxAttrs(node.openingElement)
      const route = routePathFromJsxAttr(unit, attrs, resolver)
      if (!route.index && attrs.has('path') && route.path === undefined) return
      const path = route.index ? parentPath || '/' : joinRoutePath(parentPath, route.path ?? '')
      const componentName = componentNameFromElementAttr(attrs.get('element'))
      emit(node, {
        path,
        ...(componentName ? { componentName } : {}),
        ...(route.index ? { index: true } : {}),
      })
      ts.forEachChild(node, (child) => visitJsxRoutes(child, path))
      return
    }

    if (ts.isJsxSelfClosingElement(node) && isRouteTag(jsxTagName(node), bindingEvidence)) {
      const attrs = jsxAttrs(node)
      const route = routePathFromJsxAttr(unit, attrs, resolver)
      if (!route.index && attrs.has('path') && route.path === undefined) return
      const path = route.index ? parentPath || '/' : joinRoutePath(parentPath, route.path ?? '')
      const componentName = componentNameFromElementAttr(attrs.get('element'))
      emit(node, {
        path,
        ...(componentName ? { componentName } : {}),
        ...(route.index ? { index: true } : {}),
      })
      return
    }

    ts.forEachChild(node, (child) => visitJsxRoutes(child, parentPath))
  }

  const readObjectRoute = (node: ts.ObjectLiteralExpression, parentPath: string): void => {
    let path: string | undefined
    let hasPath = false
    let index = false
    let componentName: string | undefined
    let children: ts.ArrayLiteralExpression | undefined

    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      const name = textOfName(prop.name)
      if (name === 'path') {
        hasPath = true
        path = resolver?.resolveString(unit, prop.initializer) ?? stringLiteralValue(prop.initializer)
      }
      if (name === 'index' && prop.initializer.kind === ts.SyntaxKind.TrueKeyword) index = true
      if (name === 'element') {
        const init = prop.initializer
        if (ts.isJsxElement(init)) componentName = jsxTagName(init.openingElement)
        if (ts.isJsxSelfClosingElement(init)) componentName = jsxTagName(init)
        if (ts.isIdentifier(init)) componentName = init.text
      }
      if (name === 'children' && ts.isArrayLiteralExpression(prop.initializer)) children = prop.initializer
    }

    if (hasPath && path === undefined && !index) return

    if (path !== undefined || index) {
      const fullPath = index ? parentPath || '/' : joinRoutePath(parentPath, path ?? '')
      emit(node, {
        path: fullPath,
        ...(componentName ? { componentName } : {}),
        ...(index ? { index: true } : {}),
      })
      if (children) {
        for (const child of children.elements) {
          if (ts.isObjectLiteralExpression(child)) readObjectRoute(child, fullPath)
        }
      }
      return
    }

    if (children) {
      for (const child of children.elements) {
        if (ts.isObjectLiteralExpression(child)) readObjectRoute(child, parentPath)
      }
    }
  }

  const visitObjectRoutes = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isCreateBrowserRouterCall(node.expression, bindingEvidence)) {
      const routesArg = node.arguments[0]
      if (routesArg && ts.isArrayLiteralExpression(routesArg)) {
        for (const route of routesArg.elements) {
          if (ts.isObjectLiteralExpression(route)) readObjectRoute(route, '')
        }
      }
    }
    ts.forEachChild(node, visitObjectRoutes)
  }

  visitJsxRoutes(unit.ast)
  visitObjectRoutes(unit.ast)
}
