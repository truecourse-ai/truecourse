#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { randomUUID } from 'crypto';

/**
 * Dev tooling: scaffolds a justification scratch file for a new plan slice.
 *
 * The file deliberately opens with a `#!/usr/bin/env node` shebang followed
 * by import statements grouped per CODE_STYLE.md (Node builtins first, blank
 * line, then non-builtin module imports). The shebang is a `hash_bang_line`
 * tree-sitter node that lives at the top of the `program` and must NOT cause
 * the import-formatting rule to flag any of the imports below it.
 *
 * Three shapes are covered by the single program body:
 *   - shebang + first import           (shape 07cbd51e48ba)
 *   - shebang + second import          (shape aec3562a887d)
 *   - shebang + blank-line-grouped import (shape b2d1db37ce1d)
 */

interface JustificationOptions {
  readonly slug: string;
  readonly outDir: string;
}

export function createJustification(options: JustificationOptions): string {
  const { slug, outDir } = options;
  mkdirSync(outDir, { recursive: true });

  const id = randomUUID();
  const filePath = join(outDir, `${slug}-${id}.md`);
  const template = readFileSync(join(outDir, 'TEMPLATE.md'), 'utf8');
  writeFileSync(filePath, template, 'utf8');
  return filePath;
}
