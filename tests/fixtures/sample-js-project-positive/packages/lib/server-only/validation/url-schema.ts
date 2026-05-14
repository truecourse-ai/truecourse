
declare const z: { string: () => any };

// Slug URL validation schema — /^[a-z0-9].*[^_-]$/ is ASCII-only.
// Unicode flag not needed for char-class patterns that only match ASCII.
export const ZWorkspaceUrlSchema = z
  .string()
  .regex(/^[a-z0-9].*[^_-]$/, 'URL cannot start with a digit or end with dashes or underscores.')
  .regex(/^(?!.*[-_]{2})/, 'URL cannot contain consecutive dashes or underscores.')
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'URL can only contain letters, numbers, dashes and underscores.');



declare const z: { string: () => any };
declare const PROTECTED_WORKSPACE_URLS: string[];

// Team URL format validation with ASCII alphanumeric char class — unicode flag unnecessary.
export const ZWorkspaceSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Slug can only contain letters, numbers, dashes and underscores.')
  .refine((v) => !PROTECTED_WORKSPACE_URLS.includes(v), { message: 'This slug is already taken.' });



declare const z: { string: () => any };

// Consecutive dashes/underscores prohibition — ASCII literals, unicode flag adds nothing.
export const ZSlugNoConsecutiveSeparatorsSchema = z
  .string()
  .regex(/^(?!.*[-_]{2})/, 'Slug cannot contain consecutive dashes or underscores.');
