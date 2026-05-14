import ts from 'typescript'
import { jsxAttributeValue, jsxAttrs, jsxTagName } from './jsx-helpers.js'
import { EXTRACTORS } from './metadata.js'
import type { SourceUnit } from './types.js'
import { expressionName, joinRoutePath, pushFact, rangeOf, stringLiteralValue, textOfName } from './utils.js'

function routePathFromJsxAttr(attrs: Map<string, ts.JsxAttribute>): { path?: string; index?: boolean } {
  const path = jsxAttributeValue(attrs.get('path'))
  const index = jsxAttributeValue(attrs.get('index'))
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

export function extractReactRouteFacts(unit: SourceUnit): void {
  const emit = (node: ts.Node, value: Record<string, unknown>): void => {
    pushFact(unit.facts, unit.sourceFile, rangeOf(unit.ast, node), 'ui.route', 'route.exists', value, EXTRACTORS.react)
  }

  const visitJsxRoutes = (node: ts.Node, parentPath = ''): void => {
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement) === 'Route') {
      const attrs = jsxAttrs(node.openingElement)
      const route = routePathFromJsxAttr(attrs)
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

    if (ts.isJsxSelfClosingElement(node) && jsxTagName(node) === 'Route') {
      const attrs = jsxAttrs(node)
      const route = routePathFromJsxAttr(attrs)
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
    let index = false
    let componentName: string | undefined
    let children: ts.ArrayLiteralExpression | undefined

    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      const name = textOfName(prop.name)
      if (name === 'path') path = stringLiteralValue(prop.initializer)
      if (name === 'index' && prop.initializer.kind === ts.SyntaxKind.TrueKeyword) index = true
      if (name === 'element') {
        const init = prop.initializer
        if (ts.isJsxElement(init)) componentName = jsxTagName(init.openingElement)
        if (ts.isJsxSelfClosingElement(init)) componentName = jsxTagName(init)
        if (ts.isIdentifier(init)) componentName = init.text
      }
      if (name === 'children' && ts.isArrayLiteralExpression(prop.initializer)) children = prop.initializer
    }

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
    if (ts.isCallExpression(node) && expressionName(node.expression) === 'createBrowserRouter') {
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
