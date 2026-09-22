/**
 * What the workspace says its product is — Settings › Workspace's seam, and the
 * one refusal every "connect something" surface has to know about.
 *
 * Every entry point that brings material into a workspace (a documentation
 * source, a GitHub repository, a folder on this machine, and the Document scan
 * itself) answers `workspace-description-required` while the workspace has no
 * description. That is not a dead end: the sentence is set on a page every mode
 * has, so the refusal is shown with the way there.
 */

import { toast } from 'sonner';
import { ApiError, fetchApi } from '@/lib/api';
import {
  WORKSPACE_DESCRIPTION_REQUIRED,
  type WorkspaceProfileResponse,
} from '@truecourse/shared';

/** Where the sentence is set — both modes, every edition. */
export const WORKSPACE_SETTINGS_PATH = '/settings/workspace';

export function fetchWorkspaceProfile(): Promise<WorkspaceProfileResponse> {
  return fetchApi<WorkspaceProfileResponse>('/api/workspace/profile');
}

export function saveWorkspaceDescription(description: string): Promise<WorkspaceProfileResponse> {
  return fetchApi<WorkspaceProfileResponse>('/api/workspace/profile', {
    method: 'PUT',
    body: JSON.stringify({ description }),
  });
}

/** Is this the refusal a workspace with no description answers everything with? */
export function isWorkspaceDescriptionRequired(err: unknown): boolean {
  return err instanceof ApiError && err.message === WORKSPACE_DESCRIPTION_REQUIRED;
}

/**
 * The one refusal toast, with the remedy attached — the same shape as the
 * no-provider one, because it is the same kind of wall: a setting to fill in,
 * not a failure.
 */
export function toastDescribeWorkspace(
  navigate: (to: string) => void,
  description?: string,
): void {
  toast.error('Say what this workspace builds', {
    description: description ?? 'This workspace has not said what its product is.',
    action: {
      label: 'Open settings',
      onClick: () => navigate(WORKSPACE_SETTINGS_PATH),
    },
  });
}

/**
 * Say it once, with the way out. Answers true when it handled the error, so a
 * caller reads as `if (toldToDescribeWorkspace(e, navigate)) return;` and falls
 * through to its own reporting otherwise.
 */
export function toldToDescribeWorkspace(err: unknown, navigate: (to: string) => void): boolean {
  if (!isWorkspaceDescriptionRequired(err)) return false;
  // The body's `message` is the server's human sentence; `error` was the code.
  const detail = ((err as ApiError).body as { message?: unknown } | null)?.message;
  toastDescribeWorkspace(navigate, typeof detail === 'string' ? detail : undefined);
  return true;
}
