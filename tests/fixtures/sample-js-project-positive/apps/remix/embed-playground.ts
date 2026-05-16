
// --- unknown-catch-variable shape: catch(err) instanceof Error ternary; .message access guarded, String(err) fallback ---
declare function resolvePresignToken(inputToken: string): Promise<string>;
declare function setTokenError(msg: string | null): void;
declare function setIsResolving(v: boolean): void;

async function handleTokenResolution(inputToken: string) {
  if (!inputToken) {
    return;
  }

  setTokenError(null);
  setIsResolving(true);

  try {
    const resolved = await resolvePresignToken(inputToken);
    setIsResolving(false);
    return resolved;
  } catch (err) {
    setTokenError(err instanceof Error ? err.message : String(err));
    setIsResolving(false);
    return;
  }
}
