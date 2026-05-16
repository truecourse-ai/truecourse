
// --- no-void shape: module-level-or-non-react-async-init (void migration at module load) ---
async function migrateLegacyServiceAccounts(): Promise<void> {
  console.log('Migrating legacy service accounts...');
}

void migrateLegacyServiceAccounts();
