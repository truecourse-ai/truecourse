/**
 * Style violations related to import formatting.
 */

// Some code before imports to trigger import-formatting

const BEFORE_IMPORT = 42;

// VIOLATION: style/deterministic/import-formatting
import { readFileSync } from 'fs';

// VIOLATION: style/deterministic/sorting-style
import { writeFile, readFile, appendFile } from 'fs/promises';

export function importFormatting() {
  return readFileSync && BEFORE_IMPORT && readFile && writeFile && appendFile;
}
