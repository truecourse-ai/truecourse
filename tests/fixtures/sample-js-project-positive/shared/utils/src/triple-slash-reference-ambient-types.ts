/// <reference types="./ambient-env.d.ts" />
/// <reference types="@truecourse-test/ambient-augmentation" />

// `/// <reference types="..." />` is the canonical TypeScript directive
// for pulling in ambient .d.ts declarations that cannot be expressed via
// `import` (e.g. global augmentations, library client types). It is
// not a legacy form and should not be flagged.

export function getAmbient(): string {
  return 'ambient';
}
