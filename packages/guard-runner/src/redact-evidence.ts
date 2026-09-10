import type { GuardScenarioResult } from '@truecourse/shared'
import type { WriteEvidenceParams } from './evidence.js'

// Only transcript content is sensitive. Identifiers, paths used to store evidence,
// outcome enums, and object keys must retain their meaning even if a short secret
// happens to equal one of them. Redact before JSON serialization so labels containing
// quotes or backslashes remain valid string values.
const contentFields = new Set([
  'expected',
  'actual',
  'detail',
  'stdout',
  'stderr',
  'rawStdout',
  'rawStderr',
  'normStdout',
  'normStderr',
  'spawnError',
  'infraMessage',
  'endedAtMarker',
  'argv',
  'stdin',
  'env',
  'envPins',
  'captured',
  'command',
  'expectation',
  'url',
  'visibleText',
  'console',
  'requestBody',
  'requestError',
  'body',
  'screenSummary',
  'summary',
  'rationale',
])

function redactContent(value: unknown, redact: (text: string) => string, content = false): unknown {
  if (typeof value === 'string') return content ? redact(value) : value
  if (Array.isArray(value)) return value.map((entry) => redactContent(entry, redact, content))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactContent(entry, redact, content || contentFields.has(key)),
      ]),
    )
  }
  return value
}

export function redactScenarioResult(
  result: GuardScenarioResult,
  redact: (text: string) => string,
): GuardScenarioResult {
  return {
    ...result,
    ...(result.failure ? { failure: redactContent(result.failure, redact) as GuardScenarioResult['failure'] } : {}),
  }
}

export function redactEvidence(params: WriteEvidenceParams, redact: (text: string) => string): WriteEvidenceParams {
  return {
    ...params,
    steps: params.steps.map((step) => ({
      ...(redactContent(step, redact) as typeof step),
      ...(step.api
        ? { api: { ...(redactContent(step.api, redact) as typeof step.api), path: redact(step.api.path) } }
        : {}),
      ...(step.patch
        ? { patch: step.patch.map((op) => ({ ...op, ...(op.value ? { value: redact(op.value) } : {}) })) }
        : {}),
    })),
    envPins: Object.fromEntries(Object.entries(params.envPins).map(([key, value]) => [key, redact(value)])),
    ...(params.mismatch ? { mismatch: redactContent(params.mismatch, redact) as typeof params.mismatch } : {}),
    ...(params.visual ? { visual: redactContent(params.visual, redact) as typeof params.visual } : {}),
    ...(params.infraMessage ? { infraMessage: redact(params.infraMessage) } : {}),
  }
}
