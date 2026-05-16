
// envelopeType: 'DOCUMENT' is a typed discriminant matching an EnvelopeType enum — not a magic string.
declare function seedBlankDocument(userId: number, teamId: number): Promise<{ id: string }>;
declare function apiSignin(opts: { email: string; redirectPath: string }): Promise<void>;

type EnvelopeSurface = {
  envelopeId: string;
  envelopeType: 'DOCUMENT' | 'TEMPLATE';
  userId: number;
};

export async function openDocumentEditor(userEmail: string, userId: number, teamId: number): Promise<EnvelopeSurface> {
  const document = await seedBlankDocument(userId, teamId);

  await apiSignin({
    email: userEmail,
    redirectPath: `/documents/${document.id}/edit`,
  });

  return {
    envelopeId: document.id,
    envelopeType: 'DOCUMENT',
    userId,
  };
}



// FP: typeof-type-guard-presence-check — typeof token !== 'string' type guard in test fixture helper
declare function navigateToSigningUrl(token: string): Promise<void>;

async function goToSigningPage(token: string | undefined) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('goToSigningPage: token must be a non-empty string');
  }
  await navigateToSigningUrl(token);
}
