/**
 * The address the preview is mounted at. Its own module so the data-shaped
 * parts of the shell (the real-run stream) can build preview links without
 * importing the shell component and closing an import cycle around it.
 * `PreviewShell` re-exports it, which is where everything else reads it from.
 */
export const PREVIEW_BASE = '/preview';
