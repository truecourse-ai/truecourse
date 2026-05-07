#!/usr/bin/env node
/**
 * Script with a shebang line. Tree-sitter parses `#!/usr/bin/env node` as
 * a `hash_bang_line` node at program top — it's neither code nor a
 * comment but it precedes the imports below. The import-formatting rule
 * must NOT treat the shebang as "non-import code" and flag every
 * subsequent import.
 *
 * Mirrors documenso's
 *   scripts/create-justification.ts
 *   scripts/create-plan.ts
 *   scripts/create-scratch.ts
 * where 12 import-formatting violations all fired against well-formed
 * shebang-prefixed scripts.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export function seedData(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  const template = readFileSync(join(outDir, 'template.json'), 'utf-8');
  writeFileSync(join(outDir, 'seed.json'), template);
}
