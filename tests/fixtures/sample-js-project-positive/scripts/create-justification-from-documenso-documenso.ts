#!/usr/bin/env node
/**
 * Paraphrased FP from documenso/documenso for
 * style/deterministic/import-formatting.
 *
 * A `#!/usr/bin/env node` shebang is required to appear before any
 * imports in an executable script — Node strips it before evaluation
 * and it is not "non-import code." Tree-sitter parses it as a sibling
 * of program statements (`hash_bang_line`), which the visitor was
 * mistakenly treating as code-before-imports.
 *
 * Real example: scripts/create-justification.ts at documenso@8f6be474.
 */

import { runSetup } from './setup';

export function runJustification(): void {
  runSetup();
}
