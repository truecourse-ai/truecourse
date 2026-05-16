// --- unused-export shape: monorepo-alias-cross-package-import (seed helpers consumed by sibling package) ---
// Both functions are imported by E2E test specs in the @truecourse/app-tests package
// via the workspace alias @truecourse/prisma. The analyzer only follows relative imports.

declare function createTeam(opts: { name: string; ownerId: string }): Promise<{ id: string; name: string }>;
declare function createTeamEmailRecord(opts: { teamId: string; email: string }): Promise<{ id: string; email: string }>;
declare function createEmailVerificationToken(opts: { teamId: string; email: string }): Promise<string>;

export async function seedTeamEmail(
  teamId: string,
  email: string,
): Promise<{ id: string; email: string }> {
  return createTeamEmailRecord({ teamId, email });
}

export async function seedTeamEmailVerification(
  teamId: string,
  email: string,
): Promise<string> {
  return createEmailVerificationToken({ teamId, email });
}


// --- unused-export shape: monorepo-alias-cross-package-import (seed team member helper) ---
// Imported by multiple E2E spec files (template-settings, team-documents, search-documents) in sibling package.

declare function insertTeamMember(opts: { teamId: string; userId: string; role?: string }): Promise<{ id: string; role: string }>;

export async function seedTeamMember(
  teamId: string,
  userId: string,
  role: string = 'MEMBER',
): Promise<{ id: string; role: string }> {
  return insertTeamMember({ teamId, userId, role });
}

