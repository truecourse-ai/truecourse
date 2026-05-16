
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


// type alias inside declare global { namespace PrismaJson } required by prisma-json-types-generator
declare namespace SubscriptionMeta {
  interface PlanFlags {
    tier: string;
    expiresAt: string | null;
    addOns: string[];
  }
  type BillingFlags = PlanFlags;
}

declare global {
  namespace PrismaJson {
    type BillingFlags = SubscriptionMeta.BillingFlags;
  }
}

