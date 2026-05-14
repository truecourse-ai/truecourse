
// AppError.parseError normalization: `const error = AppError.parseError(err)` as first catch statement
declare const TypedErrorParser: { parseError(e: unknown): { code: string; message: string } };
declare function showNotification(opts: { title: string; variant: string }): void;
declare function createOrganisation(name: string, slug: string): Promise<{ id: string }>;

async function handleOrganisationCreate(name: string, slug: string): Promise<void> {
  try {
    const org = await createOrganisation(name, slug);
    navigateTo(\`/org/\${org.id}\`);
  } catch (err) {
    const error = TypedErrorParser.parseError(err);
    showNotification({ title: error.message || 'Failed to create organisation', variant: 'destructive' });
  }
}

declare function navigateTo(path: string): void;
