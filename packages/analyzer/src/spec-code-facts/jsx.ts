import { extname } from 'node:path'
import ts from 'typescript'
import { JSX_EXTENSIONS } from './discovery.js'
import { jsxAttributeValue, jsxAttrs, jsxTagName, directJsxTextChildren, staticJsxText } from './jsx-helpers.js'
import { EXTRACTORS } from './metadata.js'
import type { StaticValueResolver } from './static-values.js'
import type { SourceUnit } from './types.js'
import { expressionName, pushFact, rangeOf, stringLiteralValue } from './utils.js'

const FIELD_COMPONENTS = new Set(['TextField', 'FormInput', 'SelectField', 'CheckboxField', 'SearchBox'])
const DISPLAY_TEXT_PROPS = ['label', 'title', 'message', 'text']

interface HandlerApiCall {
  method?: string
  path?: string
}

interface HandlerSemantics {
  actions: string[]
  guardedClose: boolean
  closeConditions: string[]
  apiCalls: HandlerApiCall[]
}

function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name)
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

function jsxAttributeExpression(attr: ts.JsxAttribute | undefined): ts.Expression | undefined {
  if (!attr?.initializer || !ts.isJsxExpression(attr.initializer)) return undefined
  const expression = unwrapExpression(attr.initializer.expression)
  return expression && ts.isExpression(expression) ? expression : undefined
}

function handlerNameFromExpression(node: ts.Expression | undefined): string | undefined {
  const expression = unwrapExpression(node)
  if (!expression) return undefined
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expressionName(expression)
  return undefined
}

function inferAction(text: string | undefined): string | undefined {
  if (!text) return undefined
  const normalized = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  if (/\b(delete|remove|trash)\b/.test(normalized)) return 'delete'
  if (/\b(close|cancel|dismiss)\b/.test(normalized)) return 'close'
  if (/\b(save|submit)\b/.test(normalized)) return 'save'
  if (/\b(update|edit)\b/.test(normalized)) return 'update'
  if (/\b(create|add)\b/.test(normalized)) return 'create'
  return undefined
}

function objectPropertyString(node: ts.Node | undefined, propertyName: string): string | undefined {
  const value = unwrapExpression(node)
  if (!value || !ts.isObjectLiteralExpression(value)) return undefined
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = property.name.getText().replace(/^['"]|['"]$/g, '')
    if (name !== propertyName) continue
    return stringLiteralValue(unwrapExpression(property.initializer))
  }
  return undefined
}

function fetchCallInfo(node: ts.CallExpression): HandlerApiCall | undefined {
  if (expressionName(node.expression) !== 'fetch') return undefined
  const path = stringLiteralValue(unwrapExpression(node.arguments[0]))
  const method = objectPropertyString(node.arguments[1], 'method')?.toUpperCase()
  return {
    ...(method ? { method } : {}),
    ...(path ? { path } : {}),
  }
}

function actionFromApiCall(call: HandlerApiCall): string | undefined {
  if (call.method === 'DELETE') return 'delete'
  if (call.method === 'PATCH' || call.method === 'PUT') return 'update'
  if (call.method === 'POST') return 'create'
  return undefined
}

function callsClose(node: ts.Node): boolean {
  let found = false
  const visit = (child: ts.Node): void => {
    if (found) return
    if (ts.isCallExpression(child)) {
      const name = expressionName(child.expression)
      if (name === 'onClose') {
        found = true
        return
      }
      if (/^set[A-Z].*Open$/.test(name ?? '') && child.arguments[0]?.kind === ts.SyntaxKind.FalseKeyword) {
        found = true
        return
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function analyzeHandler(name: string, body: ts.Node): HandlerSemantics {
  const actions = new Set<string>()
  const closeConditions = new Set<string>()
  const apiCalls: HandlerApiCall[] = []
  let guardedClose = false

  const nameAction = inferAction(name)
  if (nameAction) actions.add(nameAction)

  const visit = (node: ts.Node): void => {
    if (
      node !== body
      && (
        ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
      )
    ) {
      return
    }

    if (ts.isIfStatement(node) && callsClose(node.thenStatement)) {
      guardedClose = true
      closeConditions.add(node.expression.getText())
      actions.add('close')
    }

    if (ts.isCallExpression(node)) {
      if (callsClose(node)) actions.add('close')
      const apiCall = fetchCallInfo(node)
      if (apiCall) {
        apiCalls.push(apiCall)
        const action = actionFromApiCall(apiCall)
        if (action) actions.add(action)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(body)
  return {
    actions: [...actions].sort(),
    guardedClose,
    closeConditions: [...closeConditions].sort(),
    apiCalls,
  }
}

function collectHandlerSemantics(unit: SourceUnit): Map<string, HandlerSemantics> {
  const handlers = new Map<string, HandlerSemantics>()

  const addHandler = (name: string, node: ts.Node | undefined): void => {
    const value = unwrapExpression(node)
    if (!value) return
    if (ts.isFunctionDeclaration(value) || ts.isFunctionExpression(value) || ts.isArrowFunction(value)) {
      if (value.body) handlers.set(name, analyzeHandler(name, value.body))
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) addHandler(node.name.text, node)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) addHandler(node.name.text, node.initializer)
    ts.forEachChild(node, visit)
  }

  visit(unit.ast)
  return handlers
}

function emitModalFacts(unit: SourceUnit): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isIfStatement(node)
      && node.expression.getText().replace(/\s+/g, '') === '!isOpen'
      && node.thenStatement.getText().replace(/\s+/g, '').includes('returnnull')
    ) {
      pushFact(
        unit.facts,
        unit.sourceFile,
        rangeOf(unit.ast, node),
        'ui.modal',
        'modal.exists',
        { controlledBy: 'isOpen' },
        EXTRACTORS.jsxForm,
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(unit.ast)
}

function collectLabelMaps(
  unit: SourceUnit,
  resolver?: StaticValueResolver,
): { byFor: Map<string, string>; wrapped: Map<ts.Node, string> } {
  const byFor = new Map<string, string>()
  const wrapped = new Map<ts.Node, string>()
  const resolve = (node: ts.Node) => resolver?.resolveString(unit, node)

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement).toLowerCase() === 'label') {
      const attrs = jsxAttrs(node.openingElement)
      const htmlFor = jsxAttributeValue(attrs.get('htmlFor'), resolve)
      const labelText = staticJsxText(node, resolve)
      if (typeof htmlFor === 'string' && labelText) byFor.set(htmlFor, labelText)

      const markWrapped = (child: ts.Node): void => {
        if (
          (ts.isJsxElement(child) && ['input', 'select', 'textarea'].includes(jsxTagName(child.openingElement).toLowerCase()))
          || (ts.isJsxSelfClosingElement(child) && ['input', 'select', 'textarea'].includes(jsxTagName(child).toLowerCase()))
        ) {
          wrapped.set(child, labelText)
        }
        ts.forEachChild(child, markWrapped)
      }
      ts.forEachChild(node, markWrapped)
    }
    ts.forEachChild(node, visit)
  }

  visit(unit.ast)
  return { byFor, wrapped }
}

function emitFormField(
  unit: SourceUnit,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  tag: string,
  attrs: Map<string, ts.JsxAttribute>,
  labels: { byFor: Map<string, string>; wrapped: Map<ts.Node, string> },
  resolver?: StaticValueResolver,
): void {
  const resolve = (expression: ts.Node) => resolver?.resolveString(unit, expression)
  const name = jsxAttributeValue(attrs.get('name'), resolve)
  const id = jsxAttributeValue(attrs.get('id'), resolve)
  const type = jsxAttributeValue(attrs.get('type'), resolve)
  const required = jsxAttributeValue(attrs.get('required'), resolve)
  const label = (typeof id === 'string' ? labels.byFor.get(id) : undefined) ?? labels.wrapped.get(node)
  pushFact(
    unit.facts,
    unit.sourceFile,
    rangeOf(unit.ast, node),
    'ui.form_field',
    'field.exists',
    {
      tag,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof id === 'string' ? { id } : {}),
      ...(typeof type === 'string' ? { type } : {}),
      ...(label ? { label } : {}),
      required: required === true || required === 'true',
    },
    EXTRACTORS.jsxForm,
  )
}

function emitComposedFormField(
  unit: SourceUnit,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  tag: string,
  attrs: Map<string, ts.JsxAttribute>,
  resolver?: StaticValueResolver,
): void {
  const resolve = (expression: ts.Node) => resolver?.resolveString(unit, expression)
  const name = jsxAttributeValue(attrs.get('name'), resolve)
  const id = jsxAttributeValue(attrs.get('id'), resolve)
  const label = jsxAttributeValue(attrs.get('label'), resolve)
    ?? jsxAttributeValue(attrs.get('aria-label'), resolve)
    ?? jsxAttributeValue(attrs.get('placeholder'), resolve)
  if ((typeof name !== 'string' && typeof id !== 'string') || typeof label !== 'string') return

  const type = jsxAttributeValue(attrs.get('type'), resolve)
  const required = jsxAttributeValue(attrs.get('required'), resolve)
  pushFact(
    unit.facts,
    unit.sourceFile,
    rangeOf(unit.ast, node),
    'ui.form_field',
    'field.exists',
    {
      tag,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof id === 'string' ? { id } : {}),
      ...(typeof type === 'string' ? { type } : {}),
      label,
      required: required === true || required === 'true',
    },
    EXTRACTORS.jsxForm,
  )
}

function emitComposedDisplayText(
  unit: SourceUnit,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attrs: Map<string, ts.JsxAttribute>,
  resolver?: StaticValueResolver,
): void {
  const resolve = (expression: ts.Node) => resolver?.resolveString(unit, expression)
  for (const propName of DISPLAY_TEXT_PROPS) {
    const text = jsxAttributeValue(attrs.get(propName), resolve)
    if (typeof text !== 'string' || !text.trim()) continue
    pushFact(
      unit.facts,
      unit.sourceFile,
      rangeOf(unit.ast, attrs.get(propName) ?? node),
      'ui.text',
      'text.visible',
      { text: text.trim() },
      EXTRACTORS.jsxText,
    )
  }
}

function visibleJsxChildrenText(node: ts.JsxElement, resolveExpression?: (node: ts.Node) => string | undefined): string {
  const parts: string[] = []
  const visitChildren = (children: ts.NodeArray<ts.JsxChild>): void => {
    for (const child of children) {
      if (ts.isJsxText(child)) {
        const text = child.getText().replace(/\s+/g, ' ').trim()
        if (text) parts.push(text)
      } else if (ts.isJsxExpression(child) && child.expression) {
        const text = resolveExpression?.(child.expression) ?? stringLiteralValue(child.expression)
        if (text) parts.push(text.trim())
      } else if (ts.isJsxElement(child)) {
        visitChildren(child.children)
      } else if (ts.isJsxFragment(child)) {
        visitChildren(child.children)
      }
    }
  }
  visitChildren(node.children)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function emitUiActions(
  unit: SourceUnit,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  tag: string,
  attrs: Map<string, ts.JsxAttribute>,
  handlers: Map<string, HandlerSemantics>,
  resolver?: StaticValueResolver,
): void {
  const resolve = (expression: ts.Node) => resolver?.resolveString(unit, expression)
  const onClick = jsxAttributeExpression(attrs.get('onClick'))
  const handlerName = handlerNameFromExpression(onClick)
  const handler = handlerName ? handlers.get(handlerName) : undefined
  const label = tag === 'button' && ts.isJsxElement(node) ? visibleJsxChildrenText(node, resolve) : undefined
  const title = jsxAttributeValue(attrs.get('title'), resolve)
  const ariaLabel = jsxAttributeValue(attrs.get('aria-label'), resolve)
  const actions = new Set<string>()

  for (const candidate of [
    typeof label === 'string' ? label : undefined,
    typeof title === 'string' ? title : undefined,
    typeof ariaLabel === 'string' ? ariaLabel : undefined,
    handlerName,
  ]) {
    const action = inferAction(candidate)
    if (action) actions.add(action)
  }

  for (const action of handler?.actions ?? []) actions.add(action)
  if (actions.size === 0) return

  for (const action of [...actions].sort()) {
    const apiCall = handler?.apiCalls.find((call) => actionFromApiCall(call) === action)
    pushFact(
      unit.facts,
      unit.sourceFile,
      rangeOf(unit.ast, node),
      'ui.action',
      'action.exists',
      {
        action,
        tag,
        ...(typeof label === 'string' && label ? { label } : {}),
        ...(typeof title === 'string' ? { title } : {}),
        ...(typeof ariaLabel === 'string' ? { ariaLabel } : {}),
        ...(handlerName ? { handler: handlerName } : {}),
        ...(action === 'close' ? { guarded: handler?.guardedClose === true } : {}),
        ...(apiCall?.method ? { method: apiCall.method } : {}),
        ...(apiCall?.path ? { path: apiCall.path } : {}),
      },
      EXTRACTORS.jsxForm,
    )
  }
}

function hasNativeFieldDescendant(node: ts.Node): boolean {
  let found = false
  const visit = (child: ts.Node): void => {
    if (found) return
    if (
      (ts.isJsxElement(child) && ['input', 'select', 'textarea'].includes(jsxTagName(child.openingElement).toLowerCase()))
      || (ts.isJsxSelfClosingElement(child) && ['input', 'select', 'textarea'].includes(jsxTagName(child).toLowerCase()))
    ) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return found
}

export function extractJsxFacts(unit: SourceUnit, resolver?: StaticValueResolver): void {
  if (!JSX_EXTENSIONS.has(extname(unit.absPath).toLowerCase())) return
  const labels = collectLabelMaps(unit, resolver)
  const handlers = collectHandlerSemantics(unit)
  emitModalFacts(unit)
  for (const [handler, semantics] of handlers) {
    if (!semantics.guardedClose) continue
    pushFact(
      unit.facts,
      unit.sourceFile,
      undefined,
      'ui.guard',
      'guard.exists',
      { event: 'close', handler, conditions: semantics.closeConditions },
      EXTRACTORS.jsxForm,
    )
  }

  const emitTextIfVisible = (node: ts.JsxElement | ts.JsxSelfClosingElement): void => {
    if (ts.isJsxSelfClosingElement(node)) return
    const tag = jsxTagName(node.openingElement).toLowerCase()
    if (['script', 'style', 'textarea', 'option', 'label', 'button'].includes(tag)) return
    for (const textChild of directJsxTextChildren(node, (expression) => resolver?.resolveString(unit, expression))) {
      pushFact(
        unit.facts,
        unit.sourceFile,
        rangeOf(unit.ast, textChild.node),
        'ui.text',
        'text.visible',
        { text: textChild.text },
        EXTRACTORS.jsxText,
      )
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const tag = jsxTagName(node.openingElement).toLowerCase()
      const attrs = jsxAttrs(node.openingElement)
      emitUiActions(unit, node, tag, attrs, handlers, resolver)

      if (['input', 'select', 'textarea'].includes(tag)) {
        emitFormField(unit, node, tag, attrs, labels, resolver)
      } else if (tag === 'label') {
        const label = visibleJsxChildrenText(node, (expression) => resolver?.resolveString(unit, expression))
        const htmlFor = jsxAttributeValue(attrs.get('htmlFor'), (expression) => resolver?.resolveString(unit, expression))
        if (label && typeof htmlFor !== 'string' && !hasNativeFieldDescendant(node)) {
          pushFact(
            unit.facts,
            unit.sourceFile,
            rangeOf(unit.ast, node),
            'ui.form_field',
            'field.exists',
            { tag, label, required: false },
            EXTRACTORS.jsxForm,
          )
        }
      } else if (tag === 'button') {
        const label = visibleJsxChildrenText(node, (expression) => resolver?.resolveString(unit, expression))
        if (label) {
          const type = jsxAttributeValue(attrs.get('type'), (expression) => resolver?.resolveString(unit, expression))
          pushFact(
            unit.facts,
            unit.sourceFile,
            rangeOf(unit.ast, node),
            'ui.button',
            'button.exists',
            { label, ...(typeof type === 'string' ? { type } : {}) },
            EXTRACTORS.jsxForm,
          )
        }
      } else if (isPascalCase(jsxTagName(node.openingElement))) {
        if (FIELD_COMPONENTS.has(jsxTagName(node.openingElement))) {
          emitComposedFormField(unit, node, jsxTagName(node.openingElement), attrs, resolver)
        } else {
          emitComposedDisplayText(unit, node, attrs, resolver)
        }
      }

      emitTextIfVisible(node)
    }

    if (ts.isJsxSelfClosingElement(node)) {
      const tag = jsxTagName(node).toLowerCase()
      const attrs = jsxAttrs(node)
      emitUiActions(unit, node, tag, attrs, handlers, resolver)
      if (['input', 'select', 'textarea'].includes(tag)) {
        emitFormField(unit, node, tag, attrs, labels, resolver)
      } else if (isPascalCase(jsxTagName(node))) {
        if (FIELD_COMPONENTS.has(jsxTagName(node))) {
          emitComposedFormField(unit, node, jsxTagName(node), attrs, resolver)
        } else {
          emitComposedDisplayText(unit, node, attrs, resolver)
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(unit.ast)
}
