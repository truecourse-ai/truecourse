
// --- redundant-type-alias FP: alias inside declare global { namespace PrismaJson } ---
// These aliases are required by prisma-json-types-generator — NOT redundant
declare namespace StorageMetadata {
  interface ClaimInfo {
    tier: string;
    expiresAt: string | null;
    features: string[];
  }
  type ClaimFlags = ClaimInfo;
}

declare global {
  namespace PrismaJson {
    type ClaimFlags = StorageMetadata.ClaimFlags;
  }
}
