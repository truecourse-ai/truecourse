import ts from 'typescript'
import { stringLiteralValue } from './utils.js'

export function jsxAttributeValue(attr: ts.JsxAttribute | undefined): string | boolean | undefined {
  if (!attr) return undefined
  if (!attr.initializer) return true
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text
  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
    if (attr.initializer.expression.kind === ts.SyntaxKind.TrueKeyword) return true
    return stringLiteralValue(attr.initializer.expression)
  }
  return undefined
}

export function jsxAttrs(node: ts.JsxOpeningLikeElement): Map<string, ts.JsxAttribute> {
  const attrs = new Map<string, ts.JsxAttribute>()
  for (const prop of node.attributes.properties) {
    if (ts.isJsxAttribute(prop)) attrs.set(prop.name.getText(), prop)
  }
  return attrs
}

export function jsxTagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText()
}

export function staticJsxText(node: ts.Node): string {
  const parts: string[] = []
  const visit = (child: ts.Node): void => {
    if (ts.isJsxText(child)) {
      const text = child.getText().replace(/\s+/g, ' ').trim()
      if (text) parts.push(text)
      return
    }
    if (ts.isJsxExpression(child) && child.expression) {
      const text = stringLiteralValue(child.expression)
      if (text) parts.push(text.trim())
      return
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function directJsxTextChildren(node: ts.JsxElement): Array<{ text: string; node: ts.Node }> {
  const texts: Array<{ text: string; node: ts.Node }> = []
  for (const child of node.children) {
    if (ts.isJsxText(child)) {
      const text = child.getText().replace(/\s+/g, ' ').trim()
      if (text) texts.push({ text, node: child })
    } else if (ts.isJsxExpression(child) && child.expression) {
      const text = stringLiteralValue(child.expression)?.trim()
      if (text) texts.push({ text, node: child })
    }
  }
  return texts
}
