
// --- unknown-catch-variable shape: catch(err) console.error('prefix:', err) only; no further access ---
declare function parseBase64Json<T>(encoded: string): T;
declare function setEmbedFeatures(features: Record<string, boolean>): void;
declare function setExternalId(id: string): void;

function parseEmbedParamsFromHash(hash: string) {
  try {
    const decoded = parseBase64Json<{ features?: Record<string, boolean>; externalId?: string }>(
      decodeURIComponent(atob(hash.slice(1))),
    );

    if (decoded.features) {
      setEmbedFeatures(decoded.features);
    }

    if (decoded.externalId) {
      setExternalId(decoded.externalId);
    }
  } catch (err) {
    console.error('Error parsing embedding params:', err);
  }
}
