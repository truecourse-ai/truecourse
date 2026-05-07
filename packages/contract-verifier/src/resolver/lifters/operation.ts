/**
 * Operation lifter — turns the generic StatementNode tree of an `operation`
 * artifact into a typed `OperationContract`.
 *
 * Only the spec-side concerns we currently verify are filled in. Other
 * fields are left as `undefined` so the comparator only diffs what the
 * spec actually declared.
 */

import type { StatementNode, HeadToken } from '../../parser/index.js';
import type {
  OperationContract,
  ResponseContract,
  ConditionPredicate,
  HeaderDecl,
  EffectEdge,
  ForbidClause,
  ArtifactRef,
  BodyShape,
} from '../../types/index.js';

export interface LiftIssue {
  message: string;
  line: number;
  col: number;
}

export interface LiftedOperation {
  contract: OperationContract;
  issues: LiftIssue[];
}

/**
 * Lift an operation artifact's body block. The caller already knows the
 * method and path from the head; we only walk the body here.
 */
export function liftOperation(
  method: string,
  pathStr: string,
  body: StatementNode[],
): LiftedOperation {
  const issues: LiftIssue[] = [];
  const tags: string[] = [];
  const responses: ResponseContract[] = [];

  for (const stmt of body) {
    const head = stmt.head;
    if (head.length === 0) continue;
    if (head[0].kind !== 'ident') continue;
    const keyword = head[0].value;

    if (keyword === 'response') {
      const resp = liftResponse(stmt, issues);
      if (resp) responses.push(resp);
      continue;
    }
    if (keyword === 'tags') {
      // tags [a, b]
      const list = head.find((t) => t.kind === 'list');
      if (list && list.kind === 'list') {
        for (const item of list.items) {
          if (item.kind === 'ident') tags.push(item.value);
        }
      }
      continue;
    }
    // origin / request / preconditions — skipped at this layer; later
    // sub-lifters fill them in. We keep them out of v1 to focus on the
    // bug catalog the comparator needs.
  }

  const contract: OperationContract = {
    protocol: 'http',
    method: method.toUpperCase(),
    path: pathStr,
    responses,
    tags,
  };

  return { contract, issues };
}

// ---------------------------------------------------------------------------
// `response NUM on KIND { … }` (or `response NUM inherits Ref`)
// ---------------------------------------------------------------------------

function liftResponse(stmt: StatementNode, issues: LiftIssue[]): ResponseContract | null {
  const head = stmt.head;
  if (head.length < 2) {
    issues.push({ message: `response declaration missing status`, line: stmt.loc.line, col: stmt.loc.col });
    return null;
  }
  const statusTok = head[1];
  if (statusTok.kind !== 'number') {
    issues.push({
      message: `response declaration: status must be a number, got ${statusTok.kind}`,
      line: stmt.loc.line, col: stmt.loc.col,
    });
    return null;
  }
  const status = String(statusTok.value);

  // Form 1: `response 401 inherits AuthRequirement:auth.bearer.api`
  // Form 2: `response 201 on success { … }`
  const inheritsAt = head.findIndex((t) => t.kind === 'ident' && t.value === 'inherits');
  if (inheritsAt >= 0) {
    const refTok = head[inheritsAt + 1];
    if (!refTok || refTok.kind !== 'reference') {
      issues.push({
        message: `\`inherits\` must be followed by an artifact reference`,
        line: stmt.loc.line, col: stmt.loc.col,
      });
      return null;
    }
    return {
      status,
      inheritedFrom: { type: refTok.refType as ArtifactRef['type'], identity: refTok.identity, quoted: refTok.quoted },
    };
  }

  // Form 2.
  const onAt = head.findIndex((t) => t.kind === 'ident' && t.value === 'on');
  let condition: ConditionPredicate | undefined;
  if (onAt >= 0) {
    const kindTok = head[onAt + 1];
    if (kindTok?.kind === 'ident') {
      condition = { kind: kindTok.value as ConditionPredicate['kind'] };
    }
  }

  // Walk the response body.
  const body = stmt.block ?? [];
  const headers: HeaderDecl[] = [];
  const effects: EffectEdge[] = [];
  const forbids: ForbidClause[] = [];
  let responseBody: BodyShape | undefined;

  for (const inner of body) {
    const ih = inner.head;
    if (ih.length === 0 || ih[0].kind !== 'ident') continue;
    const k = ih[0].value;

    if (k === 'header') {
      const headerDecl = parseHeaderDecl(inner.head);
      if (headerDecl) headers.push(headerDecl);
      continue;
    }
    if (k === 'effect') {
      const e = parseEffectEdge(inner);
      if (e) effects.push(e);
      continue;
    }
    if (k === 'forbid') {
      const f = parseForbid(ih);
      if (f) forbids.push(f);
      continue;
    }
    if (k === 'body') {
      responseBody = parseResponseBody(inner);
      continue;
    }
    // resource / machine / required-role / ordering — sub-lifters handle
    // these in later phases. Untouched here.
  }

  return {
    status,
    condition,
    body: responseBody,
    headers: headers.length > 0 ? headers : undefined,
    effects: effects.length > 0 ? effects : undefined,
    forbids: forbids.length > 0 ? forbids : undefined,
  };
}

// ---------------------------------------------------------------------------
// `body Ref`              — body shape comes from an entity ref
// `body envelope Ref { error-code X }` — wrapped error envelope
// `body { field1: …, field2: … }`     — inline structural shape
// ---------------------------------------------------------------------------

function parseResponseBody(stmt: StatementNode): BodyShape | undefined {
  const head = stmt.head;
  if (head.length === 0) return undefined;

  // `body envelope Ref { error-code X }` — wrapped error envelope
  if (head[1]?.kind === 'ident' && head[1].value === 'envelope' && head[2]?.kind === 'reference') {
    const envelopeRef: ArtifactRef = {
      type: head[2].refType as ArtifactRef['type'],
      identity: head[2].identity,
      quoted: head[2].quoted,
    };
    let errorCode: string | undefined;
    let errorCodeOneOf: string[] | undefined;
    for (const inner of stmt.block ?? []) {
      const ih = inner.head;
      if (ih.length < 2 || ih[0].kind !== 'ident' || ih[0].value !== 'error-code') continue;
      // Forms:
      //   error-code <ident>
      //   error-code one-of [a, b, c]
      if (ih[1].kind === 'ident' && ih[1].value === 'one-of' && ih[2]?.kind === 'list') {
        errorCodeOneOf = ih[2].items
          .filter((t): t is Extract<HeadToken, { kind: 'ident' }> => t.kind === 'ident')
          .map((t) => t.value);
      } else if (ih[1].kind === 'ident') {
        errorCode = ih[1].value;
      }
    }
    return { envelopeRef, errorCode, errorCodeOneOf };
  }

  // `body Ref` — body shape is a reference to an entity/enum
  if (head[1]?.kind === 'reference') {
    const ref: ArtifactRef = {
      type: head[1].refType as ArtifactRef['type'],
      identity: head[1].identity,
      quoted: head[1].quoted,
    };
    return { ref };
  }

  // `body { fieldA: …, fieldB: … }` — inline structural shape. We only
  // record the field NAMES in v1; the comparator's body diff currently
  // checks key sets (e.g. spec wants {items, nextCursor}, code emits a
  // bare array → drift). Type-level checking is later.
  if (stmt.block) {
    const fields: Record<string, never> = {} as Record<string, never>;
    for (const inner of stmt.block) {
      const ih = inner.head;
      if (ih.length === 0) continue;
      // `<name>: <type> [modifiers]` — `<name>` is an ident, then a colon op.
      if (ih[0].kind === 'ident' && ih[1]?.kind === 'op' && ih[1].value === ':') {
        (fields as Record<string, unknown>)[ih[0].value] = undefined;
      }
    }
    if (Object.keys(fields).length > 0) {
      return { fields: fields as Record<string, never> };
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// `header <name> [required] [value "..."] [idempotent-under] [format "..."]`
// ---------------------------------------------------------------------------

function parseHeaderDecl(head: HeadToken[]): HeaderDecl | null {
  if (head.length < 2) return null;
  if (head[1].kind !== 'ident') return null;
  const name = head[1].value;
  let required = false;
  let value: string | undefined;
  let idempotentUnder = false;

  for (let i = 2; i < head.length; i++) {
    const t = head[i];
    if (t.kind !== 'ident') continue;
    if (t.value === 'required') required = true;
    else if (t.value === 'optional') required = false;
    else if (t.value === 'idempotent-under') idempotentUnder = true;
    else if (t.value === 'value' && head[i + 1]?.kind === 'string') {
      value = (head[i + 1] as { kind: 'string'; value: string }).value;
      i++;
    }
    // `format "..."` is consumed silently for now — the comparator doesn't
    // diff format strings yet.
  }

  return { name: name.toLowerCase(), required, value, idempotentUnder: idempotentUnder || undefined };
}

// ---------------------------------------------------------------------------
// `effect emits Ref` / `effect persist Ref { … }` / `effect state-transition Ref to <state>`
// ---------------------------------------------------------------------------

function parseEffectEdge(stmt: StatementNode): EffectEdge | null {
  const h = stmt.head;
  if (h.length < 3 || h[0].kind !== 'ident' || h[0].value !== 'effect' || h[1].kind !== 'ident') {
    return null;
  }
  const verb = h[1].value;
  const ref = h[2];
  if (ref.kind !== 'reference') return null;
  const artifactRef: ArtifactRef = {
    type: ref.refType as ArtifactRef['type'],
    identity: ref.identity,
    quoted: ref.quoted,
  };
  if (verb === 'emits') return { kind: 'emits', ref: artifactRef };
  if (verb === 'persist') return { kind: 'persist', ref: artifactRef };
  if (verb === 'state-transition') {
    // `effect state-transition Ref to <state>`
    const toAt = h.findIndex((t) => t.kind === 'ident' && t.value === 'to');
    const target = toAt >= 0 && h[toAt + 1]?.kind === 'ident' ? (h[toAt + 1] as { kind: 'ident'; value: string }).value : undefined;
    return { kind: 'state-transition', ref: artifactRef, to: target };
  }
  return null;
}

// ---------------------------------------------------------------------------
// `forbid status NUM when <state>` / `forbid query-param <name>` / etc.
// ---------------------------------------------------------------------------

function parseForbid(h: HeadToken[]): ForbidClause | null {
  if (h.length < 3 || h[0].kind !== 'ident' || h[1].kind !== 'ident') return null;
  const kindWord = h[1].value;
  if (kindWord === 'status') {
    if (h[2].kind !== 'number') return null;
    const value = h[2].value;
    let when: string | undefined;
    const whenAt = h.findIndex((t) => t.kind === 'ident' && t.value === 'when');
    if (whenAt >= 0 && h[whenAt + 1]?.kind === 'ident') {
      when = (h[whenAt + 1] as { kind: 'ident'; value: string }).value;
    }
    return { kind: 'status', value, when };
  }
  if (kindWord === 'query-param') {
    if (h[2].kind !== 'ident') return null;
    return { kind: 'query-param', value: h[2].value };
  }
  if (kindWord === 'emission') {
    return { kind: 'emission' };
  }
  return null;
}
