/**
 * The workspace's tool connections, as the Connections tab changes them. The
 * LIST is the open client's (`@/lib/api`), because the add-context dialog needs
 * it too; connecting, testing and removing are only ever done here.
 */

import { fetchApi } from '@/lib/api';
import type {
  ContextConnectionInput,
  ContextConnectionProvider,
  ContextConnectionView,
} from '@truecourse/shared';

/** Connect or re-save one tool. An omitted token keeps the stored one. */
export function saveConnection(
  provider: ContextConnectionProvider,
  input: ContextConnectionInput,
): Promise<{ connection: ContextConnectionView }> {
  return fetchApi<{ connection: ContextConnectionView }>(`/api/connections/${provider}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** The real read a sync makes, with the submitted token or the stored one. */
export function testConnection(
  provider: ContextConnectionProvider,
  input: ContextConnectionInput,
): Promise<{ ok: boolean }> {
  return fetchApi<{ ok: boolean }>(`/api/connections/${provider}/test`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Remove it; the answer names the sources it just paused. */
export function removeConnection(
  provider: ContextConnectionProvider,
): Promise<{ connection: ContextConnectionView; paused: string[] }> {
  return fetchApi<{ connection: ContextConnectionView; paused: string[] }>(
    `/api/connections/${provider}`,
    { method: 'DELETE' },
  );
}
