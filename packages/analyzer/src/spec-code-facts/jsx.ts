import { extname } from 'node:path'
import ts from 'typescript'
import { JSX_EXTENSIONS } from './discovery.js'
import { jsxAttributeValue, jsxAttrs, jsxTagName, directJsxTextChildren, staticJsxText } from './jsx-helpers.js'
import { EXTRACTORS } from './metadata.js'
import type { StaticValueResolver } from './static-values.js'
import type { SourceUnit } from './types.js'
import { pushFact, rangeOf } from './utils.js'

const FIELD_COMPONENTS = new Set(['TextField', 'FormInput', 'SelectField', 'CheckboxField', 'SearchBox'])
const DISPLAY_TEXT_PROPS = ['label', 'title', 'message', 'text']

function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name)
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

export function extractJsxFacts(unit: SourceUnit, resolver?: StaticValueResolver): void {
  if (!JSX_EXTENSIONS.has(extname(unit.absPath).toLowerCase())) return
  const labels = collectLabelMaps(unit, resolver)

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

      if (['input', 'select', 'textarea'].includes(tag)) {
        emitFormField(unit, node, tag, attrs, labels, resolver)
      } else if (tag === 'button') {
        const label = staticJsxText(node, (expression) => resolver?.resolveString(unit, expression))
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
      if (['input', 'select', 'textarea'].includes(tag)) {
        emitFormField(unit, node, tag, jsxAttrs(node), labels, resolver)
      } else if (isPascalCase(jsxTagName(node))) {
        const attrs = jsxAttrs(node)
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
