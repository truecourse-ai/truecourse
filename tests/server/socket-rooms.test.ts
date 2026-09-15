/**
 * A repository's socket room is the workspace's as well as the repo's: slugs
 * are unique only within a workspace, so the same slug in two workspaces must
 * name two rooms.
 */
import { describe, it, expect } from 'vitest';
import { repoRoom } from '../../apps/dashboard/server/src/socket/handlers';

describe('repoRoom', () => {
  it('keeps two workspaces holding the same slug in different rooms', () => {
    expect(repoRoom('org_A', 'acme-api')).not.toBe(repoRoom('org_B', 'acme-api'));
    expect(repoRoom('org_A', 'acme-api')).toBe(repoRoom('org_A', 'acme-api'));
  });
});
