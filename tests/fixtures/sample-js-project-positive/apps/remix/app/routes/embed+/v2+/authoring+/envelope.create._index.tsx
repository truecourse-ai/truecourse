
// [unknown-catch-variable] catch(err) — console.error with label + value; no further property access
declare function parseEmbedConfig(raw: string): { templateId: string; mode: string };
declare let embedConfig: { templateId: string; mode: string } | null;

function loadEmbedConfigFromHash(hash: string): void {
  try {
    embedConfig = parseEmbedConfig(decodeURIComponent(hash));
  } catch (err) {
    console.error('Error parsing embedding params:', err);
    embedConfig = null;
  }
}
