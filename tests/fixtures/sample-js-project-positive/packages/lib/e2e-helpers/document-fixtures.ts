// --- unused-export shape: monorepo-alias-cross-package-import (multiple seed helpers via package alias) ---
// These exports are imported by E2E specs in a sibling package via @truecourse/db/seed/documents.
// The analyzer only traces relative imports — cross-package alias imports are invisible to it.

declare function insertDocument(opts: { teamId: string; title: string; meta?: object }): Promise<{ id: string }>;
declare function insertTemplate(opts: { teamId: string; title: string; meta?: object }): Promise<{ id: string }>;
declare function deleteTeam(teamId: string): Promise<void>;

export async function seedTeamDocumentWithMeta(
  teamId: string,
  title: string,
  meta: object,
): Promise<{ id: string }> {
  return insertDocument({ teamId, title, meta });
}

export async function seedTeamTemplateWithMeta(
  teamId: string,
  title: string,
  meta: object,
): Promise<{ id: string }> {
  return insertTemplate({ teamId, title, meta });
}

export async function unseedTeam(teamId: string): Promise<void> {
  await deleteTeam(teamId);
}


// --- unused-export shape: monorepo-alias-cross-package-import (batch document seed helper) ---
// Imported by multiple E2E test spec files in the sibling @truecourse/app-tests package.

declare function insertManyDocuments(opts: {
  teamId: string;
  count: number;
  status?: string;
}): Promise<Array<{ id: string; title: string }>>;

export async function seedTeamDocuments(
  teamId: string,
  count: number,
  status?: string,
): Promise<Array<{ id: string; title: string }>> {
  return insertManyDocuments({ teamId, count, status });
}

