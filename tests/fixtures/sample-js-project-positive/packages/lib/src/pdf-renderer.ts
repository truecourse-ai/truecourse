
// --- env-in-library-code shape: debug-or-feature-flag-guard ---
// isDebugMode is computed once from a debug env var, not from user input.
// Reading process.env inside a library for a debug flag is intentional.
export function isDebugModeEnabled(): boolean {
  return (
    process.env.DEBUG_PDF_RENDER === '1' ||
    process.env.DEBUG_PDF_RENDER === 'true'
  );
}

export function renderFieldOverlay(
  fieldId: string,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number; debug: boolean } {
  const isDebugMode = isDebugModeEnabled();
  return {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    debug: isDebugMode,
  };
}
