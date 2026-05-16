
// FP shape f9bea963235f: loader returning typed const object with conditional computed properties — no type mismatch
declare function getUserByEmail(opts: { email: string }): Promise<{ id: string } | null>;
declare function getRecipientSignatures(opts: { recipientId: string }): Promise<Array<{ id: string }>>;
declare function isSignupEnabledForProvider(provider: string): boolean;
declare const recipient: { id: string; name?: string; email: string; role: string };
declare const fields: Array<{ type: string; customText?: string }>;
declare const document: { userId: string; folderId?: string; team?: { url: string } };
declare const user: { id: string } | null;
declare enum FieldType { NAME = 'NAME' }

async function loadSigningPage() {
  const signatures = await getRecipientSignatures({ recipientId: recipient.id });
  const isExistingUser = await getUserByEmail({ email: recipient.email })
    .then((u) => !!u)
    .catch(() => false);

  const recipientName =
    recipient.name || fields.find((field) => field.type === FieldType.NAME)?.customText || recipient.email;

  const canSignUp = !isExistingUser && isSignupEnabledForProvider('email');
  const canRedirectToFolder = user && document.userId === user.id && document.folderId && document.team?.url;
  const returnToHomePath = canRedirectToFolder ? `/t/${document.team!.url}/documents/f/${document.folderId}` : '/';

  return {
    isDocumentAccessValid: true,
    recipientName,
    signatures,
    canSignUp,
    returnToHomePath,
  } as const;
}
