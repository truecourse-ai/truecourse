import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { isAuthName } from './auth.js'
import { EXTRACTORS } from './metadata.js'
import type { FileRouteModel, SourceUnit } from './types.js'
import {
  calleeParts,
  expressionName,
  joinRoutePath,
  normalizePath,
  pushFact,
  rangeOf,
  stringLiteralValue,
} from './utils.js'

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all'])

function isRouterFactory(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node)) return false
  const parts = calleeParts(node.expression)
  return parts.join('.') === 'express.Router' || parts.join('.') === 'Router'
}

function getCallTargetAndMethod(node: ts.CallExpression): { target: string; method: string } | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null
  const method = node.expression.name.text
  const target = expressionName(node.expression.expression)
  if (!target) return null
  return { target, method }
}

function collectHandlerNames(args: readonly ts.Expression[], startIndex: number, endIndex = args.length): string[] {
  const names: string[] = []
  for (const arg of args.slice(startIndex, endIndex)) {
    if (ts.isArrayLiteralExpression(arg)) {
      for (const element of arg.elements) {
        const name = expressionName(element)
        if (name) names.push(name)
      }
    } else {
      const name = expressionName(arg)
      if (name) names.push(name)
    }
  }
  return names
}

function routeHandlerName(args: ts.NodeArray<ts.Expression>): string | undefined {
  for (let index = args.length - 1; index >= 1; index--) {
    const arg = args[index]
    if (!arg) continue
    const name = expressionName(arg)
    if (name && name !== 'array') return name
  }
  return undefined
}

function resolveImportPath(fromFile: string, specifier: string, knownFiles: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.js'),
    join(base, 'index.jsx'),
  ].map(normalizePath)
  for (const candidate of candidates) {
    if (knownFiles.has(candidate)) return candidate
  }
  return undefined
}

function collectExpressModel(unit: SourceUnit, knownFiles: Set<string>): FileRouteModel {
  const model: FileRouteModel = {
    routes: [],
    mounts: [],
    imports: [],
    routerNames: new Set(['router']),
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const targetFile = resolveImportPath(unit.absPath, node.moduleSpecifier.text, knownFiles)
      const clause = node.importClause
      if (targetFile && clause) {
        if (clause.name) model.imports.push({ localName: clause.name.text, targetFile })
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            model.imports.push({ localName: element.name.text, targetFile })
          }
        }
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isRouterFactory(node.initializer)) {
      model.routerNames.add(node.name.text)
    }

    if (ts.isCallExpression(node)) {
      const targetAndMethod = getCallTargetAndMethod(node)
      if (targetAndMethod) {
        const { target, method } = targetAndMethod
        const firstArg = node.arguments[0]

        if (ROUTE_METHODS.has(method) && firstArg) {
          const path = stringLiteralValue(firstArg)
          if (path) {
            const handlerName = routeHandlerName(node.arguments)
            const middlewares = collectHandlerNames(node.arguments, 1, Math.max(1, node.arguments.length - 1))
            model.routes.push({
              sourceFile: unit.sourceFile,
              sourceRange: rangeOf(unit.ast, node),
              target,
              method: method.toUpperCase(),
              path,
              ...(handlerName ? { handlerName } : {}),
              middlewares,
            })
          }
        }

        if (method === 'use' && firstArg) {
          const prefix = stringLiteralValue(firstArg)
          const secondArg = node.arguments[1]
          const routerRef = secondArg ? expressionName(secondArg) : undefined
          if (prefix && routerRef) {
            model.mounts.push({ sourceFile: unit.sourceFile, target, prefix, routerRef })
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(unit.ast)
  return model
}

export function emitExpressFacts(units: SourceUnit[], knownFiles: Set<string>): void {
  const models = new Map<string, FileRouteModel>()
  const fileByRel = new Map<string, SourceUnit>()
  const fileByAbs = new Map<string, SourceUnit>()

  for (const unit of units) {
    const model = collectExpressModel(unit, knownFiles)
    models.set(unit.sourceFile, model)
    fileByRel.set(unit.sourceFile, unit)
    fileByAbs.set(normalizePath(unit.absPath), unit)
  }

  const prefixes = new Map<string, Set<string>>()
  const addPrefix = (sourceFile: string, target: string, prefix: string): boolean => {
    const key = `${sourceFile}::${target}`
    const set = prefixes.get(key) ?? new Set<string>()
    const normalized = prefix || '/'
    const before = set.size
    set.add(normalized)
    prefixes.set(key, set)
    return set.size > before
  }

  for (const [sourceFile, model] of models) {
    addPrefix(sourceFile, 'app', '')
    for (const routerName of model.routerNames) addPrefix(sourceFile, routerName, '')
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [sourceFile, model] of models) {
      for (const mount of model.mounts) {
        const parentPrefixes = prefixes.get(`${sourceFile}::${mount.target}`) ?? new Set([''])
        for (const parentPrefix of parentPrefixes) {
          const combinedPrefix = joinRoutePath(parentPrefix, mount.prefix)
          const imported = model.imports.find((item) => item.localName === mount.routerRef)
          if (imported) {
            const importedUnit = fileByAbs.get(normalizePath(imported.targetFile))
            const importedModel = importedUnit ? models.get(importedUnit.sourceFile) : undefined
            const targetRouters = importedModel && importedModel.routerNames.size > 0
              ? [...importedModel.routerNames]
              : ['router']
            if (importedUnit) {
              for (const routerName of targetRouters) {
                changed = addPrefix(importedUnit.sourceFile, routerName, combinedPrefix) || changed
              }
            }
          } else {
            changed = addPrefix(sourceFile, mount.routerRef, combinedPrefix) || changed
          }
        }
      }
    }
  }

  for (const [sourceFile, model] of models) {
    const unit = fileByRel.get(sourceFile)
    if (!unit) continue

    for (const route of model.routes) {
      const routePrefixes = prefixes.get(`${sourceFile}::${route.target}`) ?? new Set([''])
      for (const prefix of routePrefixes) {
        const path = joinRoutePath(prefix, route.path)
        pushFact(
          unit.facts,
          sourceFile,
          route.sourceRange,
          'api.route',
          'route.exists',
          {
            method: route.method,
            path,
            ...(route.handlerName ? { handlerName: route.handlerName } : {}),
            middlewares: route.middlewares,
          },
          EXTRACTORS.express,
        )

        for (const middleware of route.middlewares.filter(isAuthName)) {
          pushFact(
            unit.facts,
            sourceFile,
            route.sourceRange,
            'auth.signal',
            'auth.detected',
            { signal: middleware, source: 'middleware', route: path },
            EXTRACTORS.auth,
          )
        }
      }
    }
  }
}
