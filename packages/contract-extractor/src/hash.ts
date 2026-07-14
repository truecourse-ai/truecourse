/**
 * Content-addressing helpers shared across the extractor. A slice id is
 * `sha256(specPath + headingPath + text)` so a slice survives renames /
 * re-runs as long as its content is unchanged.
 */

import crypto from 'node:crypto';

export function sliceHash(specPath: string, headingPath: string[], text: string): string {
  const h = crypto.createHash('sha256');
  h.update(specPath);
  h.update(' ');
  h.update(headingPath.join('/'));
  h.update(' ');
  h.update(text);
  return h.digest('hex');
}
