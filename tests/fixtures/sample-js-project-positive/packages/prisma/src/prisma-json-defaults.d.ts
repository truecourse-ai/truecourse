
// --- redundant-type-alias FP: DefaultRecipient alias inside declare global PrismaJson ---
declare namespace RecipientTypes {
  interface DefaultRecipient {
    name: string;
    email: string;
    role: 'signer' | 'viewer' | 'approver';
  }
}

declare global {
  namespace PrismaJson {
    type DefaultRecipient = RecipientTypes.DefaultRecipient;
  }
}
