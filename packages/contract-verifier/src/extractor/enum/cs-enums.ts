/**
 * C# enum-shape extractor. Produces `ExtractedEnum` records in the same shape
 * the TS/Python extractors do.
 *
 * Recognized shapes:
 *   1. enum declaration:  enum OrderStatus { Placed, Paid }  → values lowercased
 *   2. trigger-subset set: static readonly HashSet<string> NonTerminalSet =
 *                          new() { "paid", "shipped" }       (conventional name)
 *
 * Member-name lowercasing mirrors how string-serialized C# enums appear over
 * the wire (the contracts use lowercase values).
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { ExtractedEnum, EnumShape } from './types.js';
import { csStringText, namedChildOfType, walkCs } from '../shared/cs-nodes.js';

/** PascalCase conventional names for a value-set constant (mirrors the
 *  Python `_SET`/`VALID_` convention). Gated to avoid an un-suffixed
 *  `HashSet<string>` local spuriously matching a spec enum by value-set. */
const SET_CONVENTION = /(?:Set|Values|Statuses|Kinds|Types|Options|Choices|Allowlist)$/;
const SET_TYPE = /^(?:HashSet|ISet|SortedSet|FrozenSet|IReadOnlySet)\b/;

export function extractCsEnumsFromFile(filePath: string, source: string, tree: Tree): ExtractedEnum[] {
  const out: ExtractedEnum[] = [];
  walkCs(tree.rootNode, (node) => {
    if (node.type === 'enum_declaration') {
      const decl = extractEnumDecl(node, filePath, source);
      if (decl) out.push(decl);
    } else if (node.type === 'field_declaration') {
      const set = extractSetField(node, filePath, source);
      if (set) out.push(set);
    }
  });
  return out;
}

function extractEnumDecl(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;
  const name = source.slice(nameNode.startIndex, nameNode.endIndex);
  const body = node.childForFieldName('body') ?? namedChildOfType(node, 'enum_member_declaration_list');
  if (!body) return null;
  const values: string[] = [];
  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i);
    if (member?.type !== 'enum_member_declaration') continue;
    const memberName = member.childForFieldName('name');
    if (memberName) values.push(source.slice(memberName.startIndex, memberName.endIndex).toLowerCase());
  }
  if (values.length === 0) return null;
  return mkEnum(name, values, 'cs-enum', node, filePath);
}

function extractSetField(node: SyntaxNode, filePath: string, source: string): ExtractedEnum | null {
  const decl = namedChildOfType(node, 'variable_declaration');
  if (!decl) return null;
  const typeNode = decl.childForFieldName('type');
  const typeText = typeNode ? source.slice(typeNode.startIndex, typeNode.endIndex) : '';
  if (!SET_TYPE.test(typeText)) return null;
  const declarator = namedChildOfType(decl, 'variable_declarator');
  if (!declarator) return null;
  const nameNode = declarator.childForFieldName('name');
  if (!nameNode) return null;
  const name = source.slice(nameNode.startIndex, nameNode.endIndex);
  if (!SET_CONVENTION.test(name)) return null;
  const values: string[] = [];
  walkCs(declarator, (n) => {
    if (n.type === 'string_literal') {
      const v = csStringText(n, source);
      if (v !== null) values.push(v);
    }
  });
  if (values.length === 0) return null;
  return mkEnum(name, values, 'cs-set', node, filePath);
}

function mkEnum(name: string, values: string[], shape: EnumShape, node: SyntaxNode, filePath: string): ExtractedEnum {
  return {
    name,
    values: [...new Set(values)].sort(),
    shape,
    source: { filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
  };
}
