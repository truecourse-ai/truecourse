/**
 * Setup script — process.exit() is allowed in scripts/ directory.
 */
export function runSetup(): never {
  process.exit(0);
}



// --- positive fixture: require() in TypeScript (CJS-style tailwind config) ---
// Mode shape-e66e11fd019e: require() of a .cjs config file at top of a TS config.
// Mode shape-d55f9cab890e: const path = require('path'); next to module.exports / eslint-disable.
/* eslint-disable @typescript-eslint/no-require-imports */
declare const require: (m: string) => any;
declare const module: { exports: unknown };

function loadTailwindConfigShapeE66e11fd019e(): unknown {
  const baseConfig = require('@documenso/ui/tailwind.config.cjs');
  return baseConfig;
}

function loadTailwindConfigShapeD55f9cab890e(): unknown {
  const path = require('path');
  module.exports = { path };
  return path;
}

export const __requireImportPositiveFixture = {
  e66e11fd019e: loadTailwindConfigShapeE66e11fd019e,
  d55f9cab890e: loadTailwindConfigShapeD55f9cab890e,
};
