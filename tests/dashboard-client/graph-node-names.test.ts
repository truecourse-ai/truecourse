/**
 * Every architecture-graph node must carry an accessible name.
 *
 * React Flow renders each node wrapper (`.react-flow__node`) with
 * `role="group"` and names it solely from the node's `ariaLabel` — a group
 * takes no name from its contents, so a node without one is an anonymous
 * group that screen readers and role-based locators cannot address ("no
 * group named postgres is on the page"). These tests pin the name `useGraph`
 * attaches for every node kind it builds: services and databases at services
 * depth, and service groups / layers / modules / methods at the deeper ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGraph, SCOPE_ALL } from '@/hooks/useGraph';
import type { GraphResponse } from '@/lib/api';

const { getGraph } = vi.hoisted(() => ({ getGraph: vi.fn() }));
vi.mock('@/lib/api', () => ({ getGraph }));

type RawNode = GraphResponse['nodes'][number];

function rawNode(overrides: Partial<RawNode> & { id: string; type: string }): RawNode {
  return {
    position: { x: 0, y: 0 },
    ...overrides,
    data: {
      label: overrides.id,
      serviceType: 'api-server',
      fileCount: 1,
      layers: [],
      rootPath: '',
      ...overrides.data,
    },
  } as RawNode;
}

function respond(nodes: RawNode[]): void {
  getGraph.mockResolvedValue({ nodes, edges: [], collapsedIds: [] } as unknown as GraphResponse);
}

/** The ariaLabel React Flow will put on each node wrapper, keyed by node id. */
async function labelsById(options: Parameters<typeof useGraph>[1]) {
  const { result } = renderHook(() => useGraph('repo-1', options));
  await waitFor(() => expect(result.current.nodes.length).toBeGreaterThan(0));
  return Object.fromEntries(
    result.current.nodes.map((n) => [n.id, (n as { ariaLabel?: string }).ariaLabel]),
  );
}

describe('useGraph — node accessible names', () => {
  beforeEach(() => {
    getGraph.mockReset();
  });

  it('names service and database nodes at services depth', async () => {
    respond([
      rawNode({ id: 'api', type: 'serviceNode' }),
      rawNode({
        id: 'postgres',
        type: 'databaseNode',
        data: { label: 'postgres', databaseType: 'postgres', tableCount: 2 } as RawNode['data'],
      }),
    ]);

    expect(await labelsById({ level: 'services' })).toEqual({
      api: 'api',
      postgres: 'postgres',
    });
  });

  it('names service-group, layer, module, method and database nodes at the deeper depths', async () => {
    respond([
      rawNode({ id: 'svc', type: 'serviceGroupNode', data: { label: 'api' } as RawNode['data'] }),
      rawNode({ id: 'lyr', type: 'layerNode', parentId: 'svc', data: { label: 'routes' } as RawNode['data'] }),
      rawNode({ id: 'mod', type: 'moduleNode', parentId: 'lyr', data: { label: 'user-repository' } as RawNode['data'] }),
      rawNode({ id: 'mth', type: 'methodNode', parentId: 'mod', data: { label: 'findAllUsers' } as RawNode['data'] }),
      rawNode({ id: 'db', type: 'databaseNode', data: { label: 'postgres' } as RawNode['data'] }),
    ]);

    expect(await labelsById({ level: 'modules', scopedServiceId: SCOPE_ALL })).toEqual({
      svc: 'api',
      lyr: 'routes',
      mod: 'user-repository',
      mth: 'findAllUsers',
      db: 'postgres',
    });
  });

  it('falls back to the node id when the payload carries no label', async () => {
    respond([rawNode({ id: 'unnamed-service', type: 'serviceNode', data: { label: '  ' } as RawNode['data'] })]);

    expect(await labelsById({ level: 'services' })).toEqual({
      'unnamed-service': 'unnamed-service',
    });
  });
});
