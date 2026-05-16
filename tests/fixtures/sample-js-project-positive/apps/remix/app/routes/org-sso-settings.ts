
// Pass-through: catch(err) passes err to console.error and shows generic toast
async function configureSsoSettings(orgId: string, provider: string): Promise<void> {
  try {
    await saveSsoConfiguration(orgId, provider);
  } catch (err) {
    console.error(err);
    showToast({ title: 'Failed to configure SSO', variant: 'destructive' });
  }
}

declare function saveSsoConfiguration(orgId: string, provider: string): Promise<void>;
declare function showToast(opts: { title: string; variant: string }): void;
