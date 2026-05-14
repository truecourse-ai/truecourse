import type { Requirement } from '@truecourse/shared';
import {
  containsAny,
  extractField,
  extractTextRequirement,
  requirementText,
  stringsFromUnknown,
} from './utils.js';

export function hasAuthRequirement(requirement: Requirement): boolean {
  return requirement.constraints.some((constraint) => /(auth|permission|role)/i.test(constraint.type) || containsAny(stringsFromUnknown(constraint.value).join(' '), ['auth', 'authenticated', 'authorization', 'permission', 'role']))
    || containsAny(requirement.evidenceText, ['auth', 'authenticated', 'authorization', 'permission', 'role']);
}

export function hasRequestFieldRequirement(requirement: Requirement): boolean {
  return Boolean(extractField(requirement)) && containsAny(requirementText(requirement), ['request', 'payload', 'body', 'field']);
}

export function hasValidationMessageRequirement(requirement: Requirement): boolean {
  return Boolean(extractTextRequirement(requirement)) && containsAny(requirementText(requirement), ['validation', 'error', 'required message']);
}

