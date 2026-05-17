/**
 * AuthorizationRule comparator. For each operation in `appliesTo`,
 * walk the handler body looking for a per-row authorization check that
 * matches the rule's predicate. If absent → IDOR-class drift.
 *
 * The contract stores the predicate as an opaque string (Phase-4 doesn't yet
 * parse predicate expressions). The comparator performs a *signature*
 * match: the predicate references `request.auth` and a resource
 * member-access (`loaded.<Entity>.<field>`); the comparator looks for a
 * binary equality / inequality in the handler involving (a) a
 * `req.auth*` member-access AND (b) a member-access on a resource-like
 * variable. Conservative — false negatives possible, false positives
 * not (which is the project's invariant).
 */

import { randomUUID } from 'node:crypto';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import type {
  ContractDrift,
  ArtifactRef,
  AuthorizationRuleContract,
} from '../types/index.js';
import type { ExtractedOperation } from '../extractor/index.js';

export interface AuthorizationRuleCompareInput {
  authzRef: ArtifactRef;
  contract: AuthorizationRuleContract;
  recognizedOps: ExtractedOperation[];
}

export function compareAuthorizationRule(
  input: AuthorizationRuleCompareInput,
): ContractDrift[] {
  const out: ContractDrift[] = [];

  const targets = new Set(
    input.contract.appliesTo.operations.map((r) => r.identity),
  );
  if (targets.size === 0) return out;

  // Pull the resource field name out of the predicate string. The DSL
  // form we author looks like:
  //   request.auth.userId == loaded.Order.customerId
  // The comparator extracts `customerId` (the resource field) and
  // requires a comparison node in the handler that touches both
  // `req.auth*` and `<x>.customerId`.
  const fieldName = parseResourceField(input.contract.predicate);
  if (!fieldName) return out;

  for (const op of input.recognizedOps) {
    if (!targets.has(op.identity)) continue;
    if (!op.handlerBody || !op.handlerSource) continue;

    if (handlerHasOwnershipCheck(op.handlerBody, op.handlerSource, fieldName)) continue;

    out.push({
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: input.authzRef,
      obligationKey: `${op.identity} / missing-ownership-check`,
      severity: 'critical',
      filePath: op.filePath,
      lineStart: op.declarationLine,
      lineEnd: op.declarationLine,
      message:
        `${op.identity} is governed by AuthorizationRule \`${input.authzRef.identity}\` ` +
        `(predicate: ${JSON.stringify(input.contract.predicate)}), but the handler does ` +
        `not perform any ownership check on the loaded resource's \`${fieldName}\` field.`,
      specSide: `predicate "${input.contract.predicate}"` + (input.contract.except?.role ? ` except role ${input.contract.except.role}` : ''),
      codeSide: `no ownership comparison involving \`req.auth*\` and \`*.${fieldName}\` found in handler`,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Predicate parsing — find the resource field name (e.g. `customerId`)
// ---------------------------------------------------------------------------

function parseResourceField(predicate: string): string | null {
  // Pattern: `loaded.<Entity>.<field>` — pull the trailing identifier.
  const m = predicate.match(/loaded\.[A-Za-z_][\w]*\.([A-Za-z_][\w]*)/);
  if (m) return m[1];
  return null;
}

// ---------------------------------------------------------------------------
// Ownership-check pattern detection in the handler
// ---------------------------------------------------------------------------

function handlerHasOwnershipCheck(body: SyntaxNode, source: string, fieldName: string): boolean {
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (node.type === 'binary_expression') {
      const opNode = node.childForFieldName('operator');
      if (opNode) {
        const op = source.slice(opNode.startIndex, opNode.endIndex);
        if (op === '===' || op === '==' || op === '!==' || op === '!=') {
          const left = node.childForFieldName('left');
          const right = node.childForFieldName('right');
          if (
            left && right &&
            (matchesAuthSide(left, source) || matchesAuthSide(right, source)) &&
            (matchesResourceField(left, source, fieldName) || matchesResourceField(right, source, fieldName))
          ) {
            found = true;
            return;
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (found) return;
    }
  };
  visit(body);
  return found;
}

/** True if the expression touches `req.auth.*` (including optional chaining). */
function matchesAuthSide(node: SyntaxNode, source: string): boolean {
  // Walk up the member chain looking for `req` / `request` then `.auth`.
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.type === 'identifier') {
      const text = source.slice(cur.startIndex, cur.endIndex);
      if (text === 'req' || text === 'request') return false; // bare identifier — not enough
      return false;
    }
    if (cur.type === 'member_expression') {
      // does the chain include `.auth`?
      const text = source.slice(cur.startIndex, cur.endIndex);
      if (/\b(req|request)\.auth\b|\b(req|request)\?\.auth\b/.test(text)) return true;
      cur = cur.childForFieldName('object');
      continue;
    }
    if (cur.type === 'optional_chain_expression' || cur.type === 'subscript_expression') {
      cur = cur.childForFieldName('object');
      continue;
    }
    return false;
  }
  return false;
}

/** True if the expression terminates in `.<fieldName>` (member access). */
function matchesResourceField(node: SyntaxNode, source: string, fieldName: string): boolean {
  if (node.type !== 'member_expression') return false;
  const prop = node.childForFieldName('property');
  if (!prop) return false;
  return source.slice(prop.startIndex, prop.endIndex) === fieldName;
}
