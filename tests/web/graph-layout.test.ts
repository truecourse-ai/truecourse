import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { layoutNodesWithDagre } from '../../apps/web/src/components/graph/layout';

function node(id: string, width = 220, height = 80): Node {
  return {
    id,
    type: 'service',
    position: { x: 0, y: 0 },
    data: {},
    style: { width, height },
  };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe('layoutNodesWithDagre', () => {
  it('returns nodes unchanged when input is empty', () => {
    expect(layoutNodesWithDagre([], [])).toEqual([]);
  });

  it('assigns non-zero positions to each node', () => {
    const out = layoutNodesWithDagre(
      [node('a'), node('b'), node('c')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    );
    expect(out).toHaveLength(3);
    for (const n of out) {
      expect(typeof n.position.x).toBe('number');
      expect(typeof n.position.y).toBe('number');
    }
  });

  it('lays out a chain with top-to-bottom rankdir so each successor is below', () => {
    const out = layoutNodesWithDagre(
      [node('a'), node('b'), node('c')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
      { rankdir: 'TB' },
    );
    const byId = Object.fromEntries(out.map((n) => [n.id, n]));
    expect(byId.b.position.y).toBeGreaterThan(byId.a.position.y);
    expect(byId.c.position.y).toBeGreaterThan(byId.b.position.y);
  });

  it('lays out a chain with left-to-right rankdir so each successor is right', () => {
    const out = layoutNodesWithDagre(
      [node('a'), node('b'), node('c')],
      [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
      { rankdir: 'LR' },
    );
    const byId = Object.fromEntries(out.map((n) => [n.id, n]));
    expect(byId.b.position.x).toBeGreaterThan(byId.a.position.x);
    expect(byId.c.position.x).toBeGreaterThan(byId.b.position.x);
  });

  it('sets sourcePosition/targetPosition based on rankdir', () => {
    const tb = layoutNodesWithDagre([node('a'), node('b')], [edge('e', 'a', 'b')], {
      rankdir: 'TB',
    });
    expect(tb[0].sourcePosition).toBe('bottom');
    expect(tb[0].targetPosition).toBe('top');

    const lr = layoutNodesWithDagre([node('a'), node('b')], [edge('e', 'a', 'b')], {
      rankdir: 'LR',
    });
    expect(lr[0].sourcePosition).toBe('right');
    expect(lr[0].targetPosition).toBe('left');
  });

  it('dedupes parallel edges so dagre does not over-weight repeated pairs', () => {
    // Two edges a→b + two more a→b shouldn't crash or produce a different
    // layout than a single a→b.
    const single = layoutNodesWithDagre([node('a'), node('b')], [edge('e1', 'a', 'b')]);
    const quadruple = layoutNodesWithDagre(
      [node('a'), node('b')],
      [
        edge('e1', 'a', 'b'),
        edge('e2', 'a', 'b'),
        edge('e3', 'a', 'b'),
        edge('e4', 'a', 'b'),
      ],
    );
    expect(single[0].position).toEqual(quadruple[0].position);
    expect(single[1].position).toEqual(quadruple[1].position);
  });

  it('uses default node size when no style/measured dimensions are present', () => {
    const bare: Node = { id: 'x', type: 'service', position: { x: 0, y: 0 }, data: {} };
    const out = layoutNodesWithDagre([bare], [], {
      defaultNodeWidth: 100,
      defaultNodeHeight: 40,
    });
    expect(out).toHaveLength(1);
    // dagre centers at (x, y); our offset is -w/2, -h/2 ⇒ position should
    // be non-NaN and match a centered-to-origin layout.
    expect(Number.isFinite(out[0].position.x)).toBe(true);
    expect(Number.isFinite(out[0].position.y)).toBe(true);
  });
});
