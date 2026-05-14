// --- unused-export shape: monorepo-alias-cross-package-import (exported function used in sibling test package) ---

// This helper is imported by e2e spec files in the sibling @truecourse/app-tests package
// via the monorepo alias. The unused-export rule does not resolve cross-package imports,
// so it incorrectly flags this function as unused.
export async function apiLogout(baseUrl: string, sessionToken: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Logout failed: ${response.status}`);
  }
}


// --- unused-export shape: monorepo-alias-cross-package-import (session validation helper) ---
// Imported and used in password-related E2E specs in the sibling app-tests package.

declare function fetchSession(baseUrl: string, sessionToken: string): Promise<{ valid: boolean; userId?: string }>;

export async function checkSessionValid(
  baseUrl: string,
  sessionToken: string,
): Promise<boolean> {
  const result = await fetchSession(baseUrl, sessionToken);
  return result.valid;
}

