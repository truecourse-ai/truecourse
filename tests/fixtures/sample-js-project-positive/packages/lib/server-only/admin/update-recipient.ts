// Imported by @myapp/trpc/server/admin-router/update-recipient.ts
// dead-module rule fails to resolve the @myapp/lib cross-package alias

export interface UpdateRecipientInput {
  recipientId: string;
  name?: string;
  email?: string;
  role?: 'viewer' | 'editor' | 'owner';
}

export async function updateRecipient(input: UpdateRecipientInput): Promise<void> {
  await persistRecipientUpdate(input);
}

declare function persistRecipientUpdate(input: UpdateRecipientInput): Promise<void>;
