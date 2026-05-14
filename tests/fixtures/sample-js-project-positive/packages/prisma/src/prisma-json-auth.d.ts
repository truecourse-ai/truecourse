
// --- redundant-type-alias FP: alias inside declare global { namespace PrismaJson } ---
declare global {
  namespace PrismaJson {
    type RecipientAuthOptions = {
      accessAuth: string | null;
      actionAuth: string | null;
    };
  }
}
