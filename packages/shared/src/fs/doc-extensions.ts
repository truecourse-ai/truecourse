/**
 * The file extensions TrueCourse treats as markdown documentation — the single
 * source of truth shared by document discovery (`discoverDocs` in
 * @truecourse/spec-consolidator), the heading-aware chunker (`isMarkdownDoc` in
 * ../guard/doc-chunks.ts) and the EE github-app's PR spec-detect, so all three
 * agree on what counts as a spec document.
 *
 * These three checks were written independently and had drifted to three
 * different sets; a doc that passed one and failed another either vanished
 * silently or degraded to a whole-doc anchor. Keeping one list is what stops
 * that recurring — add an extension here, not at a call site.
 *
 * `.mdx` is included because MDX is markdown with JSX: prose, ATX headings and
 * fenced code are byte-identical to markdown, so the same heading-aware
 * treatment applies. The JSX itself is passed through untouched — it is
 * meaningful content (component attributes carry API field names and types),
 * not noise to strip.
 *
 * Node-free on purpose: ../guard/doc-chunks.ts reaches the dashboard client
 * through the root export, so this module uses string ops rather than
 * `node:path`.
 */

/** Markdown documentation extensions, lowercase, leading dot included. */
export const MARKDOWN_DOC_EXTENSIONS: readonly string[] = [
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.mdx',
];

/**
 * True when `filePath` ends in a markdown documentation extension.
 * Case-insensitive; accepts a bare filename or any path separator style.
 */
export function hasMarkdownExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return MARKDOWN_DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Drop a trailing markdown extension so a filename can be matched by stem —
 * `SPEC.mdx` and `SPEC.md` should classify alike.
 *
 * Only markdown extensions are stripped, deliberately: a bare-stem match would
 * make `prompt.txt` collide with `prompt.md`, and dotfiles like `.cursorrules`
 * (no extension at all) must survive untouched.
 */
export function stripMarkdownExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const ext of MARKDOWN_DOC_EXTENSIONS) {
    // A file named exactly `.md` is a dotfile, not an empty stem.
    if (lower.endsWith(ext) && lower.length > ext.length) {
      return fileName.slice(0, -ext.length);
    }
  }
  return fileName;
}
