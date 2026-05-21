/**
 * Single-identifier string literals appearing multiple times in technical
 * contexts — typeof comparisons, framework API tokens passed as call
 * arguments, or status field values — are not duplicated *domain* strings
 * and should not be flagged by duplicate-string or magic-string.
 */

type Bounds = { min?: unknown; max?: unknown };

export function describeBounds(bounds: Bounds): string {
  const parts: string[] = [];
  if (typeof bounds.min === 'number') {
    parts.push(`min=${bounds.min}`);
  }
  if (typeof bounds.max === 'number') {
    parts.push(`max=${bounds.max}`);
  }
  if (typeof bounds.min === 'number' && typeof bounds.max === 'number') {
    parts.push(`span=${bounds.max - bounds.min}`);
  }
  return parts.join(', ');
}

type ValidatorTarget = 'json' | 'query' | 'form';

declare function apiValidator<T>(target: ValidatorTarget, schema: T): T;
declare const userSchema: { fields: unknown };
declare const orderSchema: { fields: unknown };
declare const ticketSchema: { fields: unknown };

export const validators: ReadonlyArray<{ fields: unknown }> = [
  apiValidator('json', userSchema),
  apiValidator('json', orderSchema),
  apiValidator('json', ticketSchema),
];
