/**
 * The workspace's account connections, as the Connections tab changes them. The
 * LIST is the open client's (`@/lib/api`), because the add-context dialog needs
 * it too; connecting, testing and removing are only ever done here.
 */

import { fetchApi } from '@/lib/api';
import type {
  ContextConnectionInput,
  ContextConnectionProvider,
  ContextConnectionTestResponse,
  ContextConnectionView,
} from '@truecourse/shared';

/** Connect or re-save one account. An omitted token keeps the stored one. */
export function saveConnection(
  provider: ContextConnectionProvider,
  input: ContextConnectionInput,
): Promise<{ connection: ContextConnectionView }> {
  return fetchApi<{ connection: ContextConnectionView }>(`/api/connections/${provider}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/**
 * The real read a sync makes, once per product the account serves, with the
 * submitted token or the stored one. The answer is a verdict per product.
 */
export function testConnection(
  provider: ContextConnectionProvider,
  input: ContextConnectionInput,
): Promise<ContextConnectionTestResponse> {
  return fetchApi<ContextConnectionTestResponse>(`/api/connections/${provider}/test`, {
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
