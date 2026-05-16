
// FP shape: DOM API call (localStorage, crypto, etc.); no type mismatch
declare const crypto: { subtle: { digest: (algo: string, data: BufferSource) => Promise<ArrayBuffer> } };
declare const encoder: { encode: (s: string) => Uint8Array };

async function hashSecret(secret: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(secret));
}



// Shape: Number.isInteger() combined with comparison for validation — no type mismatch
export function getValidPageCount(rawAttr: string | null): number {
  const totalPages = Number(rawAttr);

  if (!Number.isInteger(totalPages) || totalPages < 1) {
    return 0;
  }

  return totalPages;
}
