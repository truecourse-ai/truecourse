import {
  canonicalJson,
  type CodeFact,
  type Requirement,
} from '@truecourse/shared';

const ROUTE_METHODS = ['DELETE', 'PATCH', 'POST', 'PUT', 'GET', 'ALL'];

export function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizePath(value: string): string {
  const normalized = value.trim().replace(/\/+/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringsFromUnknown(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(stringsFromUnknown);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsFromUnknown);
  return [];
}

export function requirementText(requirement: Requirement): string {
  return [
    requirement.kind,
    requirement.modality,
    requirement.subject,
    requirement.action,
    requirement.object,
    requirement.evidenceText,
    ...requirement.constraints.flatMap((constraint) => [constraint.type, ...stringsFromUnknown(constraint.value)]),
    ...(requirement.acceptanceCriteria ?? []),
  ].filter(Boolean).join(' ');
}

export function constraintValues(requirement: Requirement, pattern: RegExp): string[] {
  return requirement.constraints
    .filter((constraint) => pattern.test(constraint.type))
    .flatMap((constraint) => stringsFromUnknown(constraint.value))
    .filter((value) => value.trim().length > 0);
}

export function containsAny(text: string, needles: string[]): boolean {
  const normalized = normalizeText(text);
  return needles.some((needle) => {
    const value = normalizeText(needle);
    return value.length > 0 && normalized.includes(value);
  });
}

function words(value: string): string[] {
  return normalizeText(value).split(/[^a-z0-9_/-]+/).filter((word) => word.length >= 3);
}

export function hasSubstantialOverlap(haystack: string, needle: string): boolean {
  const needleWords = words(needle);
  if (needleWords.length === 0) return false;
  const normalizedHaystack = normalizeText(haystack);
  return needleWords.some((word) => normalizedHaystack.includes(word));
}

export function extractRoute(requirement: Requirement): { method?: string; path?: string } {
  const text = requirementText(requirement);
  const method = ROUTE_METHODS.find((candidate) => new RegExp(`\\b${candidate}\\b`, 'i').test(text));
  const path = text.match(/\/[a-z0-9_{}:.*?/-]*/i)?.[0];
  return {
    ...(method ? { method } : {}),
    ...(path ? { path: normalizePath(path) } : {}),
  };
}

export function extractUiPath(requirement: Requirement): string | undefined {
  const value = constraintValues(requirement, /(route|path|url)/i)[0]
    ?? requirement.object
    ?? requirement.evidenceText.match(/\/[a-z0-9_{}:.*?/-]*/i)?.[0];
  const path = value?.match(/\/[a-z0-9_{}:.*?/-]*/i)?.[0];
  return path ? normalizePath(path) : undefined;
}

export function extractField(requirement: Requirement): string | undefined {
  return constraintValues(requirement, /(field|input|property|column|name)/i)[0] ?? requirement.object;
}

export function extractTextRequirement(requirement: Requirement): string | undefined {
  return constraintValues(requirement, /(text|copy|label|message|error|validation)/i)[0] ?? requirement.object;
}

export function extractEnvVar(requirement: Requirement): string | undefined {
  const explicit = constraintValues(requirement, /(env|environment|variable|config)/i)[0] ?? requirement.object;
  return explicit?.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0]
    ?? requirement.evidenceText.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0];
}

export function extractRole(requirement: Requirement): string | undefined {
  return constraintValues(requirement, /(role|permission)/i)[0]
    ?? requirement.object
    ?? requirement.evidenceText.match(/\b(admin|owner|user|member|manager|editor|viewer)\b/i)?.[0];
}

function constraintValue(requirement: Requirement, type: string): string | undefined {
  return requirement.constraints
    .find((constraint) => normalizeText(constraint.type) === normalizeText(type))
    ?.value as string | undefined;
}

export function normalizeCliPhrase(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function extractCliBinary(requirement: Requirement): string | undefined {
  const explicit = constraintValue(requirement, 'cliBinary');
  if (typeof explicit === 'string' && explicit.trim()) return normalizeCliPhrase(explicit);
  const backticked = requirementText(requirement).match(/`([^`\s]+)(?:\s[^`]*)?`/)?.[1];
  return backticked ? normalizeCliPhrase(backticked) : undefined;
}

export function extractCliCommand(requirement: Requirement): string | undefined {
  const explicit = constraintValue(requirement, 'cliCommand');
  if (typeof explicit === 'string' && explicit.trim()) return normalizeCliPhrase(explicit);
  const backticked = requirementText(requirement).match(/`([^`]*\s[^`]*)`/)?.[1];
  return backticked ? normalizeCliPhrase(backticked.replace(/\s+--[^\s]+.*$/, '')) : undefined;
}

export function extractCliOption(requirement: Requirement): string | undefined {
  const explicit = constraintValue(requirement, 'cliOption');
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  return requirementText(requirement).match(/--[a-z0-9][a-z0-9-]*/i)?.[0];
}

export function extractCliArgument(requirement: Requirement): string | undefined {
  const explicit = constraintValue(requirement, 'cliArgument');
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const match = requirementText(requirement).match(/[<[]([a-zA-Z][\w-]*)(?:\.\.\.)?[>\]]/);
  return match?.[1];
}

export function factValueText(fact: CodeFact): string {
  return stringsFromUnknown(fact.value).join(' ');
}

export function routeFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'api.route' && fact.predicate === 'route.exists');
}

export function uiRouteFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'ui.route' && fact.predicate === 'route.exists');
}

export function authFacts(facts: CodeFact[]): CodeFact[] {
  return facts.filter((fact) => fact.kind === 'auth.signal' && fact.predicate === 'auth.detected');
}

export function routeMatches(requirement: Requirement, fact: CodeFact): boolean {
  const expected = extractRoute(requirement);
  const value = record(fact.value);
  const factPath = typeof value.path === 'string' ? normalizePath(value.path) : undefined;
  const factMethod = typeof value.method === 'string' ? value.method.toUpperCase() : undefined;
  if (!expected.path || !factPath || normalizePath(expected.path) !== factPath) return false;
  return !expected.method || !factMethod || expected.method === factMethod;
}

export function uiPathMatches(path: string, fact: CodeFact): boolean {
  const value = record(fact.value);
  return typeof value.path === 'string' && normalizePath(value.path) === normalizePath(path);
}

export function sortCanonical<T>(values: T[]): T[] {
  return [...values].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}
