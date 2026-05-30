import type { CodeFact } from '@truecourse/shared';
import { makeMatcher } from './matcher-factory.js';
import { complianceResult, invertStatus } from './result.js';
import {
  authFacts,
  containsAny,
  constraintValues,
  extractCliArgument,
  extractCliBinary,
  extractCliCommand,
  extractCliOption,
  extractEnvVar,
  extractField,
  extractFields,
  extractQueryParams,
  extractRole,
  extractRoute,
  extractTable,
  extractTextRequirement,
  extractUiAction,
  extractUiPath,
  extractValidationFormat,
  factValueText,
  hasSubstantialOverlap,
  normalizePath,
  normalizeTargetName,
  normalizeText,
  record,
  requirementText,
  routeFacts,
  routeMatches,
  uiPathMatches,
  uiRouteFacts,
} from './utils.js';
import { hasAuthRequirement, hasRequestFieldRequirement, hasValidationMessageRequirement } from './signals.js';

const AUTH_PATTERN = /(auth|authenticated|requireauth|ensur(e|ed)auth|guard|jwt|session|permission|role|admin|authorize)/i;

function hasConstraint(requirement: { constraints: Array<{ type: string; value?: unknown }> }, pattern: RegExp): boolean {
  return requirement.constraints.some((constraint) => pattern.test(constraint.type));
}

function constraintValuesByType(requirement: { constraints: Array<{ type: string; value?: unknown }> }, pattern: RegExp): unknown[] {
  return requirement.constraints.filter((constraint) => pattern.test(constraint.type)).map((constraint) => constraint.value);
}

function openApiFieldNames(requirement: { constraints: Array<{ type: string; value?: unknown }> }, type: RegExp, requiredOnly = false): string[] {
  return constraintValuesByType(requirement, type).flatMap((value) => {
    const entries = Array.isArray(value) ? value : [value];
    return entries.flatMap((entry) => {
      if (typeof entry === 'string' && entry.trim().length > 0) return [entry.trim()];
      const item = record(entry);
      if (typeof item.name !== 'string') return [];
      if (requiredOnly && item.required !== true) return [];
      return [item.name];
    });
  });
}

function openApiStatusCodes(requirement: { constraints: Array<{ type: string; value?: unknown }> }): number[] {
  return constraintValuesByType(requirement, /^statusCode$/i).flatMap((value) => {
    const entries = Array.isArray(value) ? value : [value];
    return entries.flatMap((entry) => {
      const numeric = Number(entry);
      return Number.isInteger(numeric) ? [numeric] : [];
    });
  });
}

function statusFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'api.response.status' && fact.predicate === 'status.returned');
}

function requestFieldFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => ['api.request.field', 'api.request_field'].includes(fact.kind));
}

function queryParamFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'api.query.param' && fact.predicate === 'param.used');
}

function validationFieldFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'api.validation.field' && fact.predicate === 'field.validated');
}

function mutationFieldFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'api.mutation.field' && fact.predicate === 'field.set');
}

function uiActionFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'ui.action' && fact.predicate === 'action.exists');
}

function factRouteMatchesRoute(fact: CodeFact, route: { method?: string; path?: string }): boolean {
  const value = record(fact.value);
  const factPath = typeof value.path === 'string' || typeof value.route === 'string' ? normalizePath(String(value.path ?? value.route)) : undefined;
  const factMethod = typeof value.method === 'string' ? value.method.toUpperCase() : undefined;
  return (!route.path || !factPath || normalizePath(route.path) === factPath)
    && (!route.method || !factMethod || route.method === factMethod);
}

function fieldFactMatches(fact: CodeFact, field: string, route: { method?: string; path?: string }): boolean {
  const value = record(fact.value);
  const factField = String(value.name ?? value.field ?? '');
  return normalizeTargetName(factField) === normalizeTargetName(field) && factRouteMatchesRoute(fact, route);
}

function hasApiValidationRequirement(requirement: Parameters<typeof requirementText>[0]): boolean {
  if (requirement.kind !== 'api') return false;
  const text = normalizeText(requirementText(requirement));
  return /\b(validat\w*|required|reject\w*|invalid|bad request|400)\b/.test(text)
    || requirement.constraints.some((constraint) => /^(validationField|requiredField|format|failureStatus)$/i.test(constraint.type));
}

function hasApiMutationRequirement(requirement: Parameters<typeof requirementText>[0]): boolean {
  if (requirement.kind !== 'api') return false;
  if (requirement.constraints.some((constraint) => /^(mutationField|updatedField|setField|persistedField)$/i.test(constraint.type))) return true;
  const text = normalizeText([requirement.action, requirement.evidenceText].join(' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
  return /\b(update|updates|updated|updating|sets?|persist|persists|persisted|write|writes|wrote|written|save|saves|saved|mark|marks|marked)\b/.test(text);
}

function validationFieldMatches(fact: CodeFact, field: string, route: { method?: string; path?: string }, format?: string): boolean {
  const value = record(fact.value);
  if (normalizeTargetName(value.name ?? value.field) !== normalizeTargetName(field)) return false;
  if (!factRouteMatchesRoute(fact, route)) return false;
  if (format && normalizeTargetName(value.format) !== normalizeTargetName(format)) return false;
  return true;
}

function normalizeUiContext(value: unknown): string {
  return normalizeTargetName(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9/-]+/gi, '-')
    .replace(/[/_\\]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function addUiContextHint(hints: Set<string>, value: unknown): void {
  const normalized = normalizeUiContext(value);
  if (!normalized) return;
  const words = normalized.split('-').filter(Boolean);
  if (words.length === 0) return;
  const stopWords = new Set(['a', 'an', 'and', 'fields', 'in', 'must', 'required', 'should', 'the', 'ui']);
  if (words.every((word) => stopWords.has(word))) return;
  if (words.some((word) => ['in', 'must', 'required', 'should'].includes(word))) return;
  hints.add(normalized);
}

function uiContextHints(requirement: Parameters<typeof requirementText>[0]): string[] {
  const text = requirementText(requirement);
  const hints = new Set<string>();
  for (const value of constraintValues(requirement, /(context|component|file|page|path|route|screen|source|uiContext)/i)) {
    addUiContextHint(hints, value);
  }
  for (const match of text.matchAll(/\/[a-z0-9_{}:[\].*?/-]+/gi)) {
    addUiContextHint(hints, normalizePath(match[0]!).replace(/^\//, ''));
  }
  for (const match of text.matchAll(/\b(?:the|a|an)\s+([A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*){0,3})\s+(?:UI|page|screen|modal|dialog|workflow)\b/gi)) {
    addUiContextHint(hints, match[1]);
  }
  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*){0,3})\s+(?:UI|page|screen|modal|dialog|workflow)\b/g)) {
    addUiContextHint(hints, match[1]);
  }
  return [...hints].filter(Boolean);
}

function factMatchesUiContext(fact: CodeFact, hints: string[]): boolean {
  if (hints.length === 0) return true;
  const haystack = normalizeUiContext([fact.sourceFile, factValueText(fact)].join(' '));
  const compactHaystack = haystack.replace(/-/g, '');
  return hints.some((hint) => {
    const normalized = normalizeUiContext(hint);
    return haystack.includes(normalized) || compactHaystack.includes(normalized.replace(/-/g, ''));
  });
}

function routeHasAuth(route: CodeFact, facts: CodeFact[]): CodeFact[] {
  const value = record(route.value);
  const routePath = typeof value.path === 'string' ? normalizePath(value.path) : undefined;
  const middlewareNames = Array.isArray(value.middlewares) ? value.middlewares.map(String) : [];
  const routeAuthFacts = authFacts(facts).filter((fact) => {
    const authValue = record(fact.value);
    return typeof authValue.route !== 'string' || !routePath || normalizePath(authValue.route) === routePath;
  });
  const authMiddlewareFacts = AUTH_PATTERN.test(middlewareNames.join(' ')) ? [route] : [];
  return [...authMiddlewareFacts, ...routeAuthFacts];
}

function cliFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind.startsWith('cli.'));
}

function cliBinaryFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'cli.binary' && fact.predicate === 'binary.defined');
}

function cliCommandFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'cli.command' && fact.predicate === 'command.defined');
}

function hasCliConstraint(requirement: { constraints: Array<{ type: string }> }, type: string): boolean {
  return requirement.constraints.some((constraint) => normalizedCli(constraint.type) === normalizedCli(type));
}

function naturalRequirementText(requirement: { subject: string; action: string; object?: string; evidenceText: string }): string {
  return [requirement.subject, requirement.action, requirement.object, requirement.evidenceText].filter(Boolean).join(' ');
}

function normalizedCli(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function commandFactMatchesTarget(fact: CodeFact, target: string, hasBinaryFacts: boolean): boolean {
  const value = record(fact.value);
  const expected = normalizedCli(target);
  const fullName = normalizedCli(value.fullName);
  if (fullName === expected) return true;
  const path = Array.isArray(value.path) ? normalizedCli(value.path.join(' ')) : '';
  if (!hasBinaryFacts && path === expected) return true;
  return false;
}

function optionFactMatches(fact: CodeFact, command: CodeFact, option: string): boolean {
  const value = record(fact.value);
  const commandValue = record(command.value);
  return normalizedCli(value.command) === normalizedCli(commandValue.fullName)
    && [value.name, value.shortName].some((candidate) => typeof candidate === 'string' && normalizedCli(candidate) === normalizedCli(option));
}

function argumentFactMatches(fact: CodeFact, command: CodeFact, arg: string): boolean {
  const value = record(fact.value);
  const commandValue = record(command.value);
  return normalizedCli(value.command) === normalizedCli(commandValue.fullName)
    && typeof value.name === 'string'
    && normalizedCli(value.name) === normalizedCli(arg);
}

export const complianceMatchers = [
  makeMatcher(
    'api.validation.field_required',
    (requirement) => requirement.kind === 'api'
      && Boolean(extractRoute(requirement).path)
      && extractFields(requirement).length > 0
      && hasApiValidationRequirement(requirement),
    ({ requirement, facts }, metadata) => {
      const route = extractRoute(requirement);
      const fields = extractFields(requirement);
      const format = extractValidationFormat(requirement);
      const routes = routeFacts(facts).filter((fact) => routeMatches(requirement, fact));
      const validationFacts = validationFieldFacts(facts);
      const matchesByField = new Map(fields.map((field) => [
        field,
        validationFacts.filter((fact) => validationFieldMatches(fact, field, route, format)),
      ]));
      const matches = [...new Map([...matchesByField.values()].flat().map((fact) => [fact.id, fact])).values()];
      const missing = fields.filter((field) => (matchesByField.get(field)?.length ?? 0) === 0);

      if (requirement.modality === 'must_not') {
        return complianceResult(requirement, metadata, matches.length > 0 ? 'conflicting' : 'satisfied', {
          conflictingFacts: matches,
          message: matches.length > 0 ? `Prohibited API validation exists for "${requirement.subject}".` : `Prohibited API validation is absent for "${requirement.subject}".`,
        });
      }

      if (routes.length === 0) {
        return complianceResult(requirement, metadata, 'missing', { message: `API route is missing for validation requirement "${requirement.subject}".` });
      }

      const status = missing.length === 0 ? 'satisfied' : matches.length > 0 ? 'partial' : 'missing';
      return complianceResult(requirement, metadata, status, {
        matchingFacts: [...routes, ...matches],
        message: missing.length === 0
          ? `API validation exists for "${fields.join(', ')}".`
          : `API validation is missing for "${missing.join(', ')}"${format ? ` with ${format} format` : ''}.`,
      });
    },
  ),
  makeMatcher(
    'api.mutation.field_set',
    (requirement) => requirement.kind === 'api'
      && Boolean(extractRoute(requirement).path)
      && extractFields(requirement).length > 0
      && hasApiMutationRequirement(requirement),
    ({ requirement, facts }, metadata) => {
      const route = extractRoute(requirement);
      const fields = extractFields(requirement);
      const routes = routeFacts(facts).filter((fact) => routeMatches(requirement, fact));
      const mutationFacts = mutationFieldFacts(facts);
      const matchesByField = new Map(fields.map((field) => [
        field,
        mutationFacts.filter((fact) => fieldFactMatches(fact, field, route)),
      ]));
      const matches = [...new Map([...matchesByField.values()].flat().map((fact) => [fact.id, fact])).values()];
      const missing = fields.filter((field) => (matchesByField.get(field)?.length ?? 0) === 0);

      if (requirement.modality === 'must_not') {
        return complianceResult(requirement, metadata, matches.length > 0 ? 'conflicting' : 'satisfied', {
          conflictingFacts: matches,
          message: matches.length > 0 ? `Prohibited API mutation exists for "${requirement.subject}".` : `Prohibited API mutation is absent for "${requirement.subject}".`,
        });
      }

      if (routes.length === 0) {
        return complianceResult(requirement, metadata, 'missing', { message: `API route is missing for mutation requirement "${requirement.subject}".` });
      }

      const status = missing.length === 0 ? 'satisfied' : matches.length > 0 ? 'partial' : 'missing';
      return complianceResult(requirement, metadata, status, {
        matchingFacts: [...routes, ...matches],
        message: missing.length === 0
          ? `API mutation sets "${fields.join(', ')}".`
          : `API mutation does not set "${missing.join(', ')}".`,
      });
    },
  ),
  makeMatcher(
    'api.openapi_operation',
    (requirement) => requirement.kind === 'api'
      && Boolean(extractRoute(requirement).path)
      && hasConstraint(requirement, /^(operationId|statusCode|requestField|responseField|securityScheme|requestSchema|responseSchema)$/i),
    ({ requirement, facts }, metadata) => {
      const route = extractRoute(requirement);
      const routes = routeFacts(facts).filter((fact) => routeMatches(requirement, fact));
      const matches: CodeFact[] = [...routes];
      const missing: string[] = [];
      const unverifiable: string[] = [];

      if (routes.length === 0) {
        missing.push('route');
      }

      if (hasAuthRequirement(requirement)) {
        const authMatches = routes.flatMap((routeFact) => routeHasAuth(routeFact, facts));
        if (routes.length > 0 && authMatches.length === 0) missing.push('auth');
        matches.push(...authMatches);
      }

      const requiredFields = openApiFieldNames(requirement, /^requestField$/i, true);
      if (requiredFields.length > 0) {
        const fieldFacts = requestFieldFacts(facts);
        if (fieldFacts.length === 0) unverifiable.push('request fields');
        for (const field of requiredFields) {
          const fieldMatches = fieldFacts.filter((fact) => fieldFactMatches(fact, field, route));
          if (fieldFacts.length > 0 && fieldMatches.length === 0) missing.push(`request field ${field}`);
          matches.push(...fieldMatches);
        }
      }

      const expectedStatusCodes = openApiStatusCodes(requirement);
      if (expectedStatusCodes.length > 0) {
        const allStatusFacts = statusFacts(facts);
        if (allStatusFacts.length === 0) unverifiable.push('response status codes');
        for (const statusCode of expectedStatusCodes) {
          const codeMatches = allStatusFacts.filter((fact) => Number(record(fact.value).statusCode) === statusCode && factRouteMatchesRoute(fact, route));
          if (allStatusFacts.length > 0 && codeMatches.length === 0) missing.push(`status ${statusCode}`);
          matches.push(...codeMatches);
        }
      }

      const responseFields = openApiFieldNames(requirement, /^responseField$/i, false);
      if (responseFields.length > 0 && !facts.some((fact) => fact.kind === 'api.response.field')) {
        unverifiable.push('response fields');
      }

      const uniqueMatches = [...new Map(matches.map((fact) => [fact.id, fact])).values()];
      let status: 'satisfied' | 'partial' | 'missing' | 'unverifiable' = 'satisfied';
      if (routes.length === 0) status = 'missing';
      else if (missing.length > 0) status = 'partial';
      else if (unverifiable.length > 0) status = uniqueMatches.length > 0 ? 'partial' : 'unverifiable';

      if (requirement.modality === 'must_not') {
        const inverted = uniqueMatches.length > 0 ? 'conflicting' : 'satisfied';
        return complianceResult(requirement, metadata, inverted, {
          matchingFacts: inverted === 'satisfied' ? [] : [],
          conflictingFacts: inverted === 'conflicting' ? uniqueMatches : [],
          message: inverted === 'conflicting' ? `Prohibited OpenAPI operation evidence exists for "${requirement.subject}".` : `Prohibited OpenAPI operation is absent for "${requirement.subject}".`,
        });
      }

      const details = [...missing, ...unverifiable.map((item) => `${item} unverifiable`)];
      return complianceResult(requirement, metadata, status, {
        matchingFacts: uniqueMatches,
        message: status === 'satisfied'
          ? `OpenAPI operation is satisfied for "${requirement.subject}".`
          : `OpenAPI operation is ${status} for "${requirement.subject}"${details.length ? `: ${details.join(', ')}.` : '.'}`,
      });
    },
  ),
  makeMatcher(
    'api.query.param_exists',
    (requirement) => requirement.kind === 'api'
      && Boolean(extractRoute(requirement).path)
      && extractQueryParams(requirement).length > 0
      && !hasAuthRequirement(requirement)
      && !hasRequestFieldRequirement(requirement),
    ({ requirement, facts }, metadata) => {
      const route = extractRoute(requirement);
      const params = extractQueryParams(requirement);
      const routes = routeFacts(facts).filter((fact) => routeMatches(requirement, fact));
      const queryFacts = queryParamFacts(facts);
      const matchesByParam = new Map(params.map((param) => [
        param,
        queryFacts.filter((fact) => {
          const value = record(fact.value);
          return normalizeTargetName(value.name) === normalizeTargetName(param) && factRouteMatchesRoute(fact, route);
        }),
      ]));
      const paramMatches = [...new Map([...matchesByParam.values()].flat().map((fact) => [fact.id, fact])).values()];
      const missingParams = params.filter((param) => (matchesByParam.get(param)?.length ?? 0) === 0);

      if (requirement.modality === 'must_not') {
        const conflicts = [...routes, ...paramMatches];
        return complianceResult(requirement, metadata, conflicts.length > 0 ? 'conflicting' : 'satisfied', {
          conflictingFacts: conflicts,
          message: conflicts.length > 0 ? `Prohibited API query parameter evidence exists for "${requirement.subject}".` : `Prohibited API query parameter evidence is absent for "${requirement.subject}".`,
        });
      }

      if (routes.length === 0) {
        return complianceResult(requirement, metadata, 'missing', { message: `API route is missing for query parameter requirement "${requirement.subject}".` });
      }

      const status = missingParams.length === 0 ? 'satisfied' : paramMatches.length > 0 ? 'partial' : 'missing';
      return complianceResult(requirement, metadata, status, {
        matchingFacts: [...routes, ...paramMatches],
        message: missingParams.length === 0
          ? `API query parameter "${params.join(', ')}" exists.`
          : `API query parameter "${missingParams.join(', ')}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'api.route.exists',
    (requirement) => requirement.kind === 'api' && Boolean(extractRoute(requirement).path) && !hasAuthRequirement(requirement) && !hasRequestFieldRequirement(requirement),
    ({ requirement, facts }, metadata) => {
      const matches = routeFacts(facts).filter((fact) => routeMatches(requirement, fact));
      const status = invertStatus(requirement, matches.length > 0);
      const evidence = requirement.modality === 'must_not' && matches.length > 0
        ? { conflictingFacts: matches, message: `Prohibited API route exists for "${requirement.subject}".` }
        : { matchingFacts: matches, message: matches.length > 0 ? `API route exists for "${requirement.subject}".` : `API route is missing for "${requirement.subject}".` };
      return complianceResult(requirement, metadata, status, evidence);
    },
  ),
  makeMatcher(
    'api.route.auth_required',
    (requirement) => requirement.kind === 'api' && Boolean(extractRoute(requirement).path) && hasAuthRequirement(requirement) && !hasRequestFieldRequirement(requirement),
    ({ requirement, facts }, metadata) => {
      const routes = routeFacts(facts).filter((fact) => routeMatches(requirement, fact));
      const authMatches = routes.flatMap((route) => routeHasAuth(route, facts));
      if (requirement.modality === 'must_not') {
        const status = authMatches.length > 0 ? 'conflicting' : 'satisfied';
        return complianceResult(requirement, metadata, status, {
          matchingFacts: status === 'satisfied' ? routes : [],
          conflictingFacts: status === 'conflicting' ? authMatches : [],
          message: status === 'conflicting' ? `Prohibited auth constraint is present for "${requirement.subject}".` : `Prohibited auth constraint is absent for "${requirement.subject}".`,
        });
      }
      if (routes.length === 0) {
        return complianceResult(requirement, metadata, 'missing', { message: `API route is missing for auth requirement "${requirement.subject}".` });
      }
      if (authMatches.length === 0) {
        return complianceResult(requirement, metadata, 'partial', { matchingFacts: routes, message: `API route exists but required auth is missing for "${requirement.subject}".` });
      }
      return complianceResult(requirement, metadata, 'satisfied', { matchingFacts: [...routes, ...authMatches], message: `API route auth is satisfied for "${requirement.subject}".` });
    },
  ),
  makeMatcher(
    'api.request.field_required',
    (requirement) => requirement.kind === 'api' && hasRequestFieldRequirement(requirement),
    ({ requirement, facts }, metadata) => {
      const taxonomy = facts.filter((fact) => ['api.request.field', 'api.request_field'].includes(fact.kind));
      if (taxonomy.length === 0) {
        return complianceResult(requirement, metadata, 'unverifiable', { message: `Request field facts are unavailable for "${requirement.subject}".` });
      }
      const fields = extractFields(requirement);
      const route = extractRoute(requirement);
      const matchesByField = new Map(fields.map((field) => [field, taxonomy.filter((fact) => fieldFactMatches(fact, field, route))]));
      const matches = [...new Map([...matchesByField.values()].flat().map((fact) => [fact.id, fact])).values()];
      const missing = fields.filter((field) => (matchesByField.get(field)?.length ?? 0) === 0);
      const matched = fields.length > 0 && missing.length === 0;
      const status = requirement.modality === 'must_not'
        ? invertStatus(requirement, matches.length > 0)
        : matched
          ? 'satisfied'
          : matches.length > 0
            ? 'partial'
            : 'missing';
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: missing.length === 0
          ? `Request field "${fields.join(', ')}" is represented in code facts.`
          : `Request field "${missing.join(', ')}" is missing from code facts.`,
      });
    },
  ),
  makeMatcher(
    'ui.route.exists',
    (requirement) => requirement.kind === 'ui' && Boolean(extractUiPath(requirement)) && containsAny(requirementText(requirement), ['route', 'page', 'screen', 'path']),
    ({ requirement, facts }, metadata) => {
      const path = extractUiPath(requirement)!;
      const matches = uiRouteFacts(facts).filter((fact) => uiPathMatches(path, fact));
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `UI route "${path}" exists.` : `UI route "${path}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'ui.close.guard_required',
    (requirement) => ['ui', 'workflow', 'ux'].includes(requirement.kind)
      && extractUiAction(requirement) === 'close'
      && /\b(guard|cannot|prevent|disabled|in flight|while|during|block)\b/i.test(requirementText(requirement)),
    ({ requirement, facts }, metadata) => {
      const closeActions = uiActionFacts(facts).filter((fact) => normalizeTargetName(record(fact.value).action) === 'close');
      const guardedActions = closeActions.filter((fact) => record(fact.value).guarded === true);
      const unguardedActions = closeActions.filter((fact) => record(fact.value).guarded === false);
      const guardFacts = facts.filter((fact) => fact.kind === 'ui.guard' && fact.predicate === 'guard.exists' && normalizeTargetName(record(fact.value).event) === 'close');
      const guarded = [...guardedActions, ...guardFacts];

      if (requirement.modality === 'must_not') {
        return complianceResult(requirement, metadata, guarded.length > 0 ? 'conflicting' : 'satisfied', {
          conflictingFacts: guarded,
          message: guarded.length > 0 ? `Prohibited close guard exists for "${requirement.subject}".` : `Prohibited close guard is absent for "${requirement.subject}".`,
        });
      }

      if (guarded.length === 0) {
        return complianceResult(requirement, metadata, 'missing', { matchingFacts: closeActions, message: `Guarded close behavior is missing for "${requirement.subject}".` });
      }

      const status = unguardedActions.length > 0 ? 'partial' : 'satisfied';
      return complianceResult(requirement, metadata, status, {
        matchingFacts: guarded,
        conflictingFacts: unguardedActions,
        message: status === 'satisfied'
          ? `Close behavior is guarded for "${requirement.subject}".`
          : `Some close actions are guarded, but unguarded close actions also exist for "${requirement.subject}".`,
      });
    },
  ),
  makeMatcher(
    'ui.action.exists',
    (requirement) => ['ui', 'workflow', 'ux'].includes(requirement.kind)
      && Boolean(extractUiAction(requirement))
      && !/\b(guard|cannot|prevent|disabled|in flight|while|during|block)\b/i.test(requirementText(requirement)),
    ({ requirement, facts }, metadata) => {
      const action = extractUiAction(requirement)!;
      const contextHints = uiContextHints(requirement);
      const matches = uiActionFacts(facts).filter((fact) => normalizeTargetName(record(fact.value).action) === normalizeTargetName(action) && factMatchesUiContext(fact, contextHints));
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `UI action "${action}" exists.` : `UI action "${action}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'ui.modal.exists',
    (requirement) => ['ui', 'workflow', 'ux'].includes(requirement.kind)
      && /\b(modal|dialog)\b/i.test(requirementText(requirement))
      && !extractUiAction(requirement),
    ({ requirement, facts }, metadata) => {
      const matches = facts.filter((fact) => fact.kind === 'ui.modal' && fact.predicate === 'modal.exists');
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `UI modal evidence exists for "${requirement.subject}".` : `UI modal evidence is missing for "${requirement.subject}".`,
      });
    },
  ),
  makeMatcher(
    'ui.text.exists',
    (requirement) => requirement.kind === 'ui' && Boolean(extractTextRequirement(requirement)) && containsAny(requirementText(requirement), ['text', 'copy', 'label', 'message']) && !hasValidationMessageRequirement(requirement),
    ({ requirement, facts }, metadata) => {
      const text = extractTextRequirement(requirement)!;
      const matches = facts.filter((fact) => fact.kind === 'ui.text' && fact.predicate === 'text.visible' && hasSubstantialOverlap(factValueText(fact), text));
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `UI text matching "${text}" exists.` : `UI text matching "${text}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'ui.form.field_exists',
    (requirement) => requirement.kind === 'ui' && Boolean(extractField(requirement)) && containsAny(requirementText(requirement), ['field', 'input', 'form']) && !hasValidationMessageRequirement(requirement),
    ({ requirement, facts }, metadata) => {
      const fields = extractFields(requirement);
      const formFacts = facts.filter((fact) => fact.kind === 'ui.form_field' && fact.predicate === 'field.exists');
      const matchesByField = new Map(fields.map((field) => [
        field,
        formFacts.filter((fact) => {
          const value = record(fact.value);
          return [value.name, value.id, value.label].some((candidate) => typeof candidate === 'string' && normalizeTargetName(candidate) === normalizeTargetName(field));
        }),
      ]));
      const matches = [...new Map([...matchesByField.values()].flat().map((fact) => [fact.id, fact])).values()];
      const missing = fields.filter((field) => (matchesByField.get(field)?.length ?? 0) === 0);
      const status = requirement.modality === 'must_not'
        ? invertStatus(requirement, matches.length > 0)
        : missing.length === 0
          ? 'satisfied'
          : matches.length > 0
            ? 'partial'
            : 'missing';
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: missing.length === 0 ? `UI form field "${fields.join(', ')}" exists.` : `UI form field "${missing.join(', ')}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'ui.form.validation_message_exists',
    (requirement) => requirement.kind === 'ui' && hasValidationMessageRequirement(requirement),
    ({ requirement, facts }, metadata) => {
      const message = extractTextRequirement(requirement)!;
      const matches = facts.filter((fact) => fact.kind === 'ui.text' && fact.predicate === 'text.visible' && hasSubstantialOverlap(factValueText(fact), message));
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `Validation message matching "${message}" exists.` : `Validation message matching "${message}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'cli.binary.exists',
    (requirement) => requirement.kind === 'cli'
      && Boolean(extractCliBinary(requirement))
      && (hasCliConstraint(requirement, 'cliBinary') || containsAny(naturalRequirementText(requirement), ['binary', 'bin'])),
    ({ requirement, facts }, metadata) => {
      const target = extractCliBinary(requirement)!;
      const allCliFacts = cliFacts(facts);
      if (requirement.modality !== 'must_not' && allCliFacts.length === 0) {
        return complianceResult(requirement, metadata, 'unverifiable', { message: `CLI facts are unavailable for "${requirement.subject}".` });
      }
      const matches = cliBinaryFacts(facts).filter((fact) => normalizedCli(record(fact.value).name) === normalizedCli(target));
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `CLI binary "${target}" exists.` : `CLI binary "${target}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'cli.command.exists',
    (requirement) => requirement.kind === 'cli' && Boolean(extractCliCommand(requirement)) && !extractCliOption(requirement) && !extractCliArgument(requirement),
    ({ requirement, facts }, metadata) => {
      const target = extractCliCommand(requirement)!;
      const allCliFacts = cliFacts(facts);
      if (requirement.modality !== 'must_not' && allCliFacts.length === 0) {
        return complianceResult(requirement, metadata, 'unverifiable', { message: `CLI facts are unavailable for "${requirement.subject}".` });
      }
      const hasBinaryFacts = cliBinaryFacts(facts).length > 0;
      const matches = cliCommandFacts(facts).filter((fact) => commandFactMatchesTarget(fact, target, hasBinaryFacts));
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `CLI command "${target}" exists.` : `CLI command "${target}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'cli.option.exists',
    (requirement) => requirement.kind === 'cli' && Boolean(extractCliOption(requirement)),
    ({ requirement, facts }, metadata) => {
      const option = extractCliOption(requirement)!;
      const commandTarget = extractCliCommand(requirement);
      const allCliFacts = cliFacts(facts);
      if (requirement.modality !== 'must_not' && allCliFacts.length === 0) {
        return complianceResult(requirement, metadata, 'unverifiable', { message: `CLI facts are unavailable for "${requirement.subject}".` });
      }
      const hasBinaryFacts = cliBinaryFacts(facts).length > 0;
      const commands = commandTarget
        ? cliCommandFacts(facts).filter((fact) => commandFactMatchesTarget(fact, commandTarget, hasBinaryFacts))
        : cliCommandFacts(facts);
      const matches = facts.filter((fact) => fact.kind === 'cli.option' && commands.some((command) => optionFactMatches(fact, command, option)));
      if (requirement.modality === 'must_not') {
        const status = matches.length > 0 ? 'conflicting' : 'satisfied';
        return complianceResult(requirement, metadata, status, {
          conflictingFacts: status === 'conflicting' ? matches : [],
          message: status === 'conflicting' ? `Prohibited CLI option "${option}" exists.` : `Prohibited CLI option "${option}" is absent.`,
        });
      }
      if (commands.length === 0) {
        return complianceResult(requirement, metadata, 'missing', { message: `CLI command is missing for option "${option}".` });
      }
      return complianceResult(requirement, metadata, matches.length > 0 ? 'satisfied' : 'partial', {
        matchingFacts: matches.length > 0 ? [...commands, ...matches] : commands,
        message: matches.length > 0 ? `CLI option "${option}" exists.` : `CLI command exists but option "${option}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'cli.argument.exists',
    (requirement) => requirement.kind === 'cli' && Boolean(extractCliArgument(requirement)),
    ({ requirement, facts }, metadata) => {
      const arg = extractCliArgument(requirement)!;
      const commandTarget = extractCliCommand(requirement);
      const allCliFacts = cliFacts(facts);
      if (requirement.modality !== 'must_not' && allCliFacts.length === 0) {
        return complianceResult(requirement, metadata, 'unverifiable', { message: `CLI facts are unavailable for "${requirement.subject}".` });
      }
      const hasBinaryFacts = cliBinaryFacts(facts).length > 0;
      const commands = commandTarget
        ? cliCommandFacts(facts).filter((fact) => commandFactMatchesTarget(fact, commandTarget, hasBinaryFacts))
        : cliCommandFacts(facts);
      const matches = facts.filter((fact) => fact.kind === 'cli.argument' && commands.some((command) => argumentFactMatches(fact, command, arg)));
      if (requirement.modality === 'must_not') {
        const status = matches.length > 0 ? 'conflicting' : 'satisfied';
        return complianceResult(requirement, metadata, status, {
          conflictingFacts: status === 'conflicting' ? matches : [],
          message: status === 'conflicting' ? `Prohibited CLI argument "${arg}" exists.` : `Prohibited CLI argument "${arg}" is absent.`,
        });
      }
      if (commands.length === 0) {
        return complianceResult(requirement, metadata, 'missing', { message: `CLI command is missing for argument "${arg}".` });
      }
      return complianceResult(requirement, metadata, matches.length > 0 ? 'satisfied' : 'partial', {
        matchingFacts: matches.length > 0 ? [...commands, ...matches] : commands,
        message: matches.length > 0 ? `CLI argument "${arg}" exists.` : `CLI command exists but argument "${arg}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'auth.role_required',
    (requirement) => requirement.kind === 'auth' && Boolean(extractRole(requirement)),
    ({ requirement, facts }, metadata) => {
      const role = extractRole(requirement)!;
      const matches = authFacts(facts).filter((fact) => hasSubstantialOverlap(factValueText(fact), role));
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `Role requirement "${role}" has matching auth evidence.` : `Role requirement "${role}" has no matching auth evidence.`,
      });
    },
  ),
  makeMatcher(
    'config.env_var_required',
    (requirement) => requirement.kind === 'config' && Boolean(extractEnvVar(requirement)),
    ({ requirement, facts }, metadata) => {
      const envVar = extractEnvVar(requirement)!;
      const matches = facts.filter((fact) => fact.kind === 'config.env' && fact.predicate === 'env.read' && normalizeText(record(fact.value).name) === normalizeText(envVar));
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `Environment variable "${envVar}" is read.` : `Environment variable "${envVar}" is not read.`,
      });
    },
  ),
  makeMatcher(
    'data.field_exists',
    (requirement) => requirement.kind === 'data' && Boolean(extractField(requirement)),
    ({ requirement, facts }, metadata) => {
      const taxonomy = facts.filter((fact) => ['data.field', 'data.schema_field'].includes(fact.kind));
      if (taxonomy.length === 0) {
        return complianceResult(requirement, metadata, 'unverifiable', { message: `Data field facts are unavailable for "${requirement.subject}".` });
      }
      const table = extractTable(requirement);
      const fields = extractFields(requirement);
      const scopedTaxonomy = table
        ? taxonomy.filter((fact) => {
          const value = record(fact.value);
          return [value.table, value.entity, value.model].some((candidate) => normalizeTargetName(candidate) === table);
        })
        : taxonomy;
      const matchesByField = new Map(fields.map((field) => [field, scopedTaxonomy.filter((fact) => {
        const value = record(fact.value);
        return [value.name, value.field, value.column].some((candidate) => typeof candidate === 'string' && normalizeTargetName(candidate) === normalizeTargetName(field));
      })]));
      const matches = [...new Map([...matchesByField.values()].flat().map((fact) => [fact.id, fact])).values()];
      const missing = fields.filter((field) => (matchesByField.get(field)?.length ?? 0) === 0);
      const status = requirement.modality === 'must_not'
        ? invertStatus(requirement, matches.length > 0)
        : missing.length === 0
          ? 'satisfied'
          : matches.length > 0
            ? 'partial'
            : 'missing';
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: missing.length === 0 ? `Data field "${fields.join(', ')}" exists.` : `Data field "${missing.join(', ')}" is missing.`,
      });
    },
  ),
  makeMatcher(
    'infra.config_fact_exists',
    (requirement) => requirement.kind === 'infra' || (requirement.kind === 'config' && !extractEnvVar(requirement)),
    ({ requirement, facts }, metadata) => {
      const target = requirement.object ?? requirement.subject;
      const candidates = facts.filter((fact) => fact.kind.startsWith('infra.') || fact.kind === 'package.script');
      if (candidates.length === 0) {
        return complianceResult(requirement, metadata, 'unverifiable', { message: `Infra/config facts are unavailable for "${requirement.subject}".` });
      }
      const matches = candidates.filter((fact) => hasSubstantialOverlap(factValueText(fact), target) || hasSubstantialOverlap(factValueText(fact), requirement.evidenceText));
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `Infra/config requirement "${target}" has matching evidence.` : `Infra/config requirement "${target}" has no matching evidence.`,
      });
    },
  ),
  makeMatcher(
    'test.coverage_hint_exists',
    (requirement) => requirement.kind === 'test',
    ({ requirement, facts }, metadata) => {
      const targets = [
        requirement.id,
        requirement.subject,
        requirement.object,
        requirement.evidenceText,
        ...(requirement.acceptanceCriteria ?? []),
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      const matches = facts.filter((fact) => fact.kind === 'test.case' && fact.predicate === 'test.named' && targets.some((target) => hasSubstantialOverlap(factValueText(fact), target)));
      const target = requirement.object ?? requirement.subject;
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `Test coverage hint exists for "${target}".` : `Test coverage hint is missing for "${target}".`,
      });
    },
  ),
  makeMatcher(
    'fallback',
    () => true,
    ({ requirement }, metadata) => complianceResult(requirement, metadata, 'unverifiable', { message: `No deterministic matcher can evaluate "${requirement.subject}".` }),
  ),
];
