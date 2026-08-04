/**
 * Container directives (`:::note … :::`) → callout elements.
 *
 * Docusaurus-based sites — the shape most fetched llms.txt pages have — write
 * their admonitions as container directives. `remark-directive` parses them;
 * this transform is the other half: it hands each container to the renderer as a
 * plain `<div>` carrying the directive's name (and its `[Custom title]` label,
 * when it has one) in data attributes, which `DocMarkdown` styles. The body
 * stays untouched mdast, so links, lists and code inside a callout render like
 * any other markdown.
 *
 * Leaf (`::name`) and text (`:name[x]`) directives get NO meaning here — they
 * are put back verbatim, sliced from the source. That is not cosmetic: with the
 * directive syntax on, prose like `see the note:here` parses as a text
 * directive, and dropping or reshaping it would silently eat the sentence.
 */

import type { Nodes, Parent, Root, RootContent, Text } from 'mdast';

/** The nodes `remark-directive` registers on mdast — named off the tree itself. */
type ContainerDirective = Extract<RootContent, { type: 'containerDirective' }>;
type InlineDirective = Extract<RootContent, { type: 'leafDirective' | 'textDirective' }>;

/** Hast property names the callout travels on — a div the sanitizer admits. */
export const ADMONITION_KIND = 'dataAdmonition';
export const ADMONITION_TITLE = 'dataAdmonitionTitle';

export function remarkAdmonitions() {
  return (tree: Root, file: { toString(): string }): undefined => {
    walk(tree, String(file));
  };
}

function walk(parent: Parent, source: string): void {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.type === 'leafDirective' || child.type === 'textDirective') {
      parent.children[i] = verbatim(child, source);
      continue;
    }
    if (child.type === 'containerDirective') asCallout(child);
    if ('children' in child) walk(child, source);
  }
}

function asCallout(node: ContainerDirective): void {
  // A `[Custom title]` label arrives as a first paragraph flagged by the parser;
  // it heads the callout instead of opening its body.
  const first = node.children[0];
  const title = first?.type === 'paragraph' && first.data?.directiveLabel ? text(first) : undefined;
  if (title !== undefined) node.children.shift();

  const data = node.data ?? (node.data = {});
  data.hName = 'div';
  data.hProperties = { [ADMONITION_KIND]: node.name, ...(title ? { [ADMONITION_TITLE]: title } : {}) };
}

function text(node: Nodes): string {
  if ('value' in node) return node.value;
  return 'children' in node ? node.children.map(text).join('') : '';
}

/**
 * The directive exactly as the author typed it — a text run in phrasing
 * position, a paragraph in flow position. Falls back to the marker + name for a
 * tree carrying no positions (nothing parsed from a string produces one).
 */
function verbatim(node: InlineDirective, source: string): RootContent {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  const marker = node.type === 'leafDirective' ? '::' : ':';
  const value = from === undefined || to === undefined ? `${marker}${node.name}` : source.slice(from, to);
  const run: Text = { type: 'text', value, position: node.position };
  return node.type === 'leafDirective' ? { type: 'paragraph', children: [run], position: node.position } : run;
}
