import type { CodeFact } from '@truecourse/shared';
import { makeMatcher } from './matcher-factory.js';
import { complianceResult, invertStatus } from './result.js';
import {
  authFacts,
  containsAny,
  extractCliArgument,
  extractCliBinary,
  extractCliCommand,
  extractCliOption,
  extractEnvVar,
  extractField,
  extractRole,
  extractRoute,
  extractTextRequirement,
  extractUiPath,
  factValueText,
  hasSubstantialOverlap,
  normalizePath,
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
  return normalizeText(factField) === normalizeText(field) && factRouteMatchesRoute(fact, route);
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
      const field = extractField(requirement)!;
      const route = extractRoute(requirement);
      const matches = taxonomy.filter((fact) => {
        const value = record(fact.value);
        const factField = String(value.name ?? value.field ?? '');
        const factPath = typeof value.route === 'string' || typeof value.path === 'string' ? normalizePath(String(value.route ?? value.path)) : undefined;
        const factMethod = typeof value.method === 'string' ? value.method.toUpperCase() : undefined;
        return normalizeText(factField) === normalizeText(field)
          && (!route.path || !factPath || normalizePath(route.path) === factPath)
          && (!route.method || !factMethod || route.method === factMethod);
      });
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `Request field "${field}" is represented in code facts.` : `Request field "${field}" is missing from code facts.`,
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
      const field = extractField(requirement)!;
      const matches = facts.filter((fact) => {
        if (fact.kind !== 'ui.form_field' || fact.predicate !== 'field.exists') return false;
        const value = record(fact.value);
        return [value.name, value.id, value.label].some((candidate) => typeof candidate === 'string' && normalizeText(candidate) === normalizeText(field));
      });
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `UI form field "${field}" exists.` : `UI form field "${field}" is missing.`,
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
      const field = extractField(requirement)!;
      const matches = taxonomy.filter((fact) => {
        const value = record(fact.value);
        return [value.name, value.field, value.column].some((candidate) => typeof candidate === 'string' && normalizeText(candidate) === normalizeText(field));
      });
      const status = invertStatus(requirement, matches.length > 0);
      return complianceResult(requirement, metadata, status, {
        matchingFacts: requirement.modality === 'must_not' ? [] : matches,
        conflictingFacts: requirement.modality === 'must_not' ? matches : [],
        message: matches.length > 0 ? `Data field "${field}" exists.` : `Data field "${field}" is missing.`,
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
