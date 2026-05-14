import { extname } from 'node:path'
import ts from 'typescript'
import { JSX_EXTENSIONS } from './discovery.js'
import { jsxAttributeValue, jsxAttrs, jsxTagName, directJsxTextChildren, staticJsxText } from './jsx-helpers.js'
import { EXTRACTORS } from './metadata.js'
import type { SourceUnit } from './types.js'
import { pushFact, rangeOf } from './utils.js'

function collectLabelMaps(unit: SourceUnit): { byFor: Map<string, string>; wrapped: Map<ts.Node, string> } {
  const byFor = new Map<string, string>()
  const wrapped = new Map<ts.Node, string>()

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement).toLowerCase() === 'label') {
      const attrs = jsxAttrs(node.openingElement)
      const htmlFor = jsxAttributeValue(attrs.get('htmlFor'))
      const labelText = staticJsxText(node)
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
): void {
  const name = jsxAttributeValue(attrs.get('name'))
  const id = jsxAttributeValue(attrs.get('id'))
  const type = jsxAttributeValue(attrs.get('type'))
  const required = jsxAttributeValue(attrs.get('required'))
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

export function extractJsxFacts(unit: SourceUnit): void {
  if (!JSX_EXTENSIONS.has(extname(unit.absPath).toLowerCase())) return
  const labels = collectLabelMaps(unit)

  const emitTextIfVisible = (node: ts.JsxElement | ts.JsxSelfClosingElement): void => {
    if (ts.isJsxSelfClosingElement(node)) return
    const tag = jsxTagName(node.openingElement).toLowerCase()
    if (['script', 'style', 'textarea', 'option', 'label', 'button'].includes(tag)) return
    for (const textChild of directJsxTextChildren(node)) {
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
        emitFormField(unit, node, tag, attrs, labels)
      } else if (tag === 'button') {
        const label = staticJsxText(node)
        if (label) {
          const type = jsxAttributeValue(attrs.get('type'))
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
      }

      emitTextIfVisible(node)
    }

    if (ts.isJsxSelfClosingElement(node)) {
      const tag = jsxTagName(node).toLowerCase()
      if (['input', 'select', 'textarea'].includes(tag)) {
        emitFormField(unit, node, tag, jsxAttrs(node), labels)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(unit.ast)
}
