/**
 * Naming a workspace on an operator console.
 *
 * Who a workspace IS belongs to the identity provider, which the ledgers these
 * consoles read have no client for and no business holding — so a console is
 * handed the auth layer's cached lookup and composes the name on top of its own
 * rows. A server with no identity provider (local mode, a test) has no lookup
 * and every row is listed by its id.
 *
 * A lookup that fails never fails the page: the operator is reading a ledger,
 * and a row without a name is still a row. It simply goes back to being an id,
 * and the log says so ONCE per workspace rather than once per read.
 */

import { log } from '@truecourse/core/lib/logger';

/** An organization's display name, as the identity provider knows it. */
export type WorkspaceNameLookup = (organizationId: string) => Promise<string | undefined>;

const unnamed = new Set<string>();

export async function resolveWorkspaceName(
  lookup: WorkspaceNameLookup | undefined,
  organizationId: string,
): Promise<string | null> {
  if (!lookup) return null;
  try {
    const name = await lookup(organizationId);
    if (name) {
      unnamed.delete(organizationId);
      return name;
    }
    warnUnnamed(organizationId, 'the identity provider has no name for it');
  } catch (e) {
    warnUnnamed(organizationId, (e as Error).message);
  }
  return null;
}

function warnUnnamed(organizationId: string, why: string): void {
  if (unnamed.has(organizationId)) return;
  unnamed.add(organizationId);
  log.warn(`[operator] could not name ${organizationId}: ${why}`);
}
