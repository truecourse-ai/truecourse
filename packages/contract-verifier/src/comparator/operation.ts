/**
 * Operation comparator — diff spec-side vs code-side OperationContract.
 *
 * v1 covers the four Operation-only drift classes from the bug catalog:
 *   1. response.<N> missing                       (status declared, code never emits N)
 *   2. response.<N>.headers.<name> missing        (header required, code never sets)
 *   3. response.<N>.body.shape mismatch           (shape: bare-array vs structured)
 *   4. forbidden status emission                  (e.g. `forbid status 200 when resource-missing`)
 *
 * Cross-cutting concerns (auth-bearer presence, pagination scheme/limit,
 * error-envelope shape) are handled by their own comparators in Phase 2;
 * Operation here only diffs what the Operation artifact itself declares.
 */

import { randomUUID } from 'node:crypto';
import type {
  OperationContract,
  ResponseContract,
  ContractDrift,
  ArtifactRef,
  HeaderDecl,
  ForbidClause,
  Severity,
} from '../types/index.js';

export interface CompareInput {
  /** Spec-side contract from the .tc file. */
  spec: OperationContract;
  /** Code-side contract extracted from the implementation. */
  code: OperationContract;
  /** Where the spec artifact lives (used in drift report). */
  specRef: ArtifactRef;
  /** Where the implementation handler lives (anchor for the drift). */
  codeFilePath: string;
  codeDeclarationLine: number;
}

export function compareOperation(input: CompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];

  // Build a code-side index by status for fast lookup.
  const codeByStatus = new Map<string, ResponseContract>();
  for (const r of input.code.responses) codeByStatus.set(r.status, r);

  for (const specResp of input.spec.responses) {
    // 401/403 inherited responses are validated by the cross-cutting
    // comparator (`AuthRequirement` / `AuthorizationRule`), not here.
    if (specResp.inheritedFrom) continue;

    const codeResp = codeByStatus.get(specResp.status);

    // (1) status missing
    if (!codeResp) {
      out.push(makeDrift(input, {
        obligationKey: `response.${specResp.status}`,
        severity: 'critical',
        message:
          `Response status ${specResp.status} is declared by the spec ` +
          `(${describeCondition(specResp)}) but the implementation never emits it.`,
        specSide: `response ${specResp.status} ${describeCondition(specResp)}`,
        codeSide: codeStatusList(input.code),
      }));
      continue;
    }

    // (2) required header missing
    for (const h of specResp.headers ?? []) {
      if (!h.required) continue;
      const codeHeader = codeResp.headers?.find((ch) => ch.name === h.name);
      if (!codeHeader) {
        out.push(makeDrift(input, {
          obligationKey: `response.${specResp.status}.headers.${h.name}`,
          severity: 'critical',
          message:
            `Response ${specResp.status} must set the \`${h.name}\` header (${describeHeader(h)}). ` +
            `Implementation does not emit it.`,
          specSide: `header ${h.name} required`,
          codeSide: codeResp.headers?.length
            ? `headers: ${codeResp.headers.map((c) => c.name).join(', ')}`
            : `no headers set on this response`,
        }));
      }
    }

    // (3) body shape drift
    if (specResp.body && codeResp.body) {
      const drift = diffBodyShape(specResp, codeResp);
      if (drift) {
        out.push(makeDrift(input, {
          obligationKey: `response.${specResp.status}.body.shape`,
          severity: drift.severity,
          message: drift.message,
          specSide: drift.specSide,
          codeSide: drift.codeSide,
        }));
      }
    }
  }

  // (4) forbidden behaviors — for each spec `forbid` clause, check code.
  for (const specResp of input.spec.responses) {
    if (!specResp.forbids) continue;
    for (const f of specResp.forbids) {
      const violation = checkForbidViolated(f, input.code, specResp.status);
      if (violation) {
        out.push(makeDrift(input, {
          obligationKey: `response.${specResp.status}.forbid.${forbidKey(f)}`,
          severity: 'critical',
          message: violation,
          specSide: describeForbid(f),
          codeSide: codeStatusList(input.code),
        }));
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Body shape diff
// ---------------------------------------------------------------------------

interface BodyShapeDriftDescription {
  severity: Severity;
  message: string;
  specSide: string;
  codeSide: string;
}

function diffBodyShape(spec: ResponseContract, code: ResponseContract): BodyShapeDriftDescription | null {
  const sb = spec.body!;
  const cb = code.body!;

  // Code emitted a bare array but spec expects a wrapped object shape.
  if (cb.errorCode === 'bare-array' && sb.fields && Object.keys(sb.fields).length > 0) {
    return {
      severity: 'critical',
      message:
        `Response ${spec.status} body must be a wrapped object ` +
        `(spec keys: ${Object.keys(sb.fields).join(', ')}). ` +
        `Implementation emits a bare array.`,
      specSide: `body: { ${Object.keys(sb.fields).join(', ')} }`,
      codeSide: `body: bare array`,
    };
  }

  // Both have field maps — compare keys.
  if (sb.fields && cb.fields) {
    const specKeys = new Set(Object.keys(sb.fields));
    const codeKeys = new Set(Object.keys(cb.fields));
    const missing = [...specKeys].filter((k) => !codeKeys.has(k));
    if (missing.length > 0) {
      return {
        severity: 'critical',
        message:
          `Response ${spec.status} body missing required key(s): ${missing.join(', ')}.`,
        specSide: `keys: ${[...specKeys].join(', ')}`,
        codeSide: `keys: ${[...codeKeys].join(', ')}`,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Forbid-clause checking
// ---------------------------------------------------------------------------

function checkForbidViolated(
  f: ForbidClause,
  code: OperationContract,
  parentStatus: string,
): string | null {
  if (f.kind === 'status' && typeof f.value === 'number') {
    // Path-sensitive check: a `forbid status 200 when resource-missing` clause
    // sitting inside a `response 404 on not_found` block is satisfied as
    // long as the implementation HAS a 404 path (the missing case is
    // guarded). It only drifts when 200 is emitted AND the parent's
    // status (e.g. 404) is NOT — meaning the code papers over the
    // missing case with a silent success.
    const codeEmitsForbidden = code.responses.some((r) => r.status === String(f.value));
    const codeEmitsParent = code.responses.some((r) => r.status === parentStatus);
    if (codeEmitsForbidden && !codeEmitsParent) {
      return (
        `Response status ${f.value} is forbidden by the spec` +
        (f.when ? ` when ${f.when}` : '') +
        ` (the ${parentStatus} guard path is missing). Implementation emits ${f.value} unconditionally.`
      );
    }
  }
  // query-param / emission forbids — handled by other comparators
  // (PaginationContract, EffectGroup) where their selectors apply.
  return null;
}

function forbidKey(f: ForbidClause): string {
  if (f.kind === 'status') return `status-${f.value}${f.when ? `-when-${f.when}` : ''}`;
  if (f.kind === 'query-param') return `query-param-${String(f.value)}`;
  if (f.kind === 'emission') return `emission`;
  return f.kind;
}

// ---------------------------------------------------------------------------
// Render helpers (used in drift `specSide` / `codeSide` snippets)
// ---------------------------------------------------------------------------

function describeCondition(r: ResponseContract): string {
  if (r.condition) return `on ${r.condition.kind}`;
  return '';
}

function describeHeader(h: HeaderDecl): string {
  return [h.required ? 'required' : 'optional', h.value ? `value ${JSON.stringify(h.value)}` : '']
    .filter(Boolean)
    .join(', ');
}

function describeForbid(f: ForbidClause): string {
  if (f.kind === 'status') return `forbid status ${f.value}${f.when ? ` when ${f.when}` : ''}`;
  if (f.kind === 'query-param') return `forbid query-param ${f.value}`;
  return `forbid ${f.kind}`;
}

function codeStatusList(code: OperationContract): string {
  if (code.responses.length === 0) return `no response status emissions detected`;
  return `code emits status: ${[...new Set(code.responses.map((r) => r.status))].sort().join(', ')}`;
}

// ---------------------------------------------------------------------------
// Drift constructor
// ---------------------------------------------------------------------------

function makeDrift(
  input: CompareInput,
  args: { obligationKey: string; severity: Severity; message: string; specSide: string; codeSide: string },
): ContractDrift {
  return {
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: input.specRef,
    obligationKey: args.obligationKey,
    severity: args.severity,
    filePath: input.codeFilePath,
    lineStart: input.codeDeclarationLine,
    lineEnd: input.codeDeclarationLine,
    message: args.message,
    specSide: args.specSide,
    codeSide: args.codeSide,
  };
}
