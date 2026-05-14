// Seed script for test data — Math.random() for non-production direct-link token
declare function createDirectLink(opts: { templateId: string; token: string; enabled: boolean }): Promise<void>;

async function seedTemplateDirectLink(templateId: string) {
  await createDirectLink({
    templateId,
    enabled: true,
    token: Math.random().toString(),
  });
}


// Seed script recipient token — Math.random().toString().slice(2,7) for non-production test fixtures
declare function createSeedRecipient(opts: { envelopeId: string; email: string; token: string }): Promise<void>;

async function seedRecipient(envelopeId: string) {
  await createSeedRecipient({
    envelopeId,
    email: 'test-recipient@example.com',
    token: Math.random().toString().slice(2, 7),
  });
}
