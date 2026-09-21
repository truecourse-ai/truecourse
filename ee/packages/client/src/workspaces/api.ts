/**
 * The organizations the signed-in user belongs to, and the two moves between
 * them. These mint the session cookie, so they sit on the auth router rather
 * than behind the gate.
 */

import { fetchApi } from '@/lib/api';
import type { AuthUser, WorkspacesResponse } from '@truecourse/shared';

export function listWorkspaces(): Promise<WorkspacesResponse> {
  return fetchApi<WorkspacesResponse>('/api/auth/workspaces');
}

/**
 * Create one and go into it. The session comes back in the new organization.
 *
 * A workspace is named AND DESCRIBED: the description is what every document it
 * holds is attributed against, and nothing connects into a workspace without
 * one, so it is stated where the workspace begins.
 */
export function createWorkspace(name: string, description: string): Promise<{ user: AuthUser }> {
  return fetchApi<{ user: AuthUser }>('/api/auth/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export function switchWorkspace(organizationId: string): Promise<{ user: AuthUser }> {
  return fetchApi<{ user: AuthUser }>('/api/auth/workspaces/switch', {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}
