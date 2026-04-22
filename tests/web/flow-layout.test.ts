import { describe, it, expect } from 'vitest';
import { buildFlowLayout, type FlowLayoutStep } from '../../apps/web/src/components/flows/layout';

function step(
  n: number,
  src: string,
  srcMod: string,
  tgt: string,
  tgtMod: string,
  stepType = 'call',
  extras: Partial<FlowLayoutStep> = {},
): FlowLayoutStep {
  return {
    stepOrder: n,
    sourceService: src,
    sourceModule: srcMod,
    targetService: tgt,
    targetModule: tgtMod,
    stepType,
    ...extras,
  };
}

describe('buildFlowLayout', () => {
  it('returns empty layout when steps are empty', () => {
    const out = buildFlowLayout({ steps: [] });
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
    expect(out.height).toBe(0);
    expect(out.width).toBe(0);
  });

  it('creates one participant per unique service::module, in first-seen order', () => {
    const out = buildFlowLayout({
      steps: [
        step(1, 'api', 'controller', 'user', 'handler'),
        step(2, 'user', 'handler', 'user', 'db'),
        step(3, 'api', 'controller', 'user', 'handler'),
      ],
    });
    const participants = out.nodes.filter((n) => n.type === 'participant').map((n) => n.id);
    expect(participants).toEqual([
      'participant-api::controller',
      'participant-user::handler',
      'participant-user::db',
    ]);
  });

  it('emits 2 anchors + 1 edge per step', () => {
    const steps = [
      step(1, 'a', 'a', 'b', 'b'),
      step(2, 'b', 'b', 'c', 'c'),
      step(3, 'c', 'c', 'a', 'a'),
    ];
    const out = buildFlowLayout({ steps });
    const anchors = out.nodes.filter((n) => n.type === 'anchor');
    expect(anchors).toHaveLength(steps.length * 2);
    expect(out.edges).toHaveLength(steps.length);
    for (const edge of out.edges) {
      expect(edge.type).toBe('step');
      expect(edge.source).toMatch(/^step-src-\d+$/);
      expect(edge.target).toMatch(/^step-tgt-\d+$/);
    }
  });

  it('skips stepDetail nodes when includeStepDetails is false (default)', () => {
    const out = buildFlowLayout({
      steps: [step(1, 'a', 'a', 'b', 'b'), step(2, 'b', 'b', 'a', 'a')],
    });
    expect(out.nodes.filter((n) => n.type === 'stepDetail')).toHaveLength(0);
  });

  it('emits one stepDetail per step when includeStepDetails is true', () => {
    const out = buildFlowLayout({
      steps: [step(1, 'a', 'a', 'b', 'b', 'call', { targetMethod: 'foo' })],
      includeStepDetails: true,
    });
    const details = out.nodes.filter((n) => n.type === 'stepDetail');
    expect(details).toHaveLength(1);
    expect((details[0].data as { methodName: string }).methodName).toBe('foo');
  });

  it('marks every step as active when no playback is provided (static view)', () => {
    // Important: ADR fragment snapshots don't have a player — without this
    // default, all edges would render in the dimmed "not yet played" grey.
    const out = buildFlowLayout({
      steps: [
        step(1, 'a', 'a', 'b', 'b'),
        step(2, 'b', 'b', 'c', 'c'),
        step(3, 'c', 'c', 'd', 'd'),
      ],
    });
    for (const edge of out.edges) {
      const d = edge.data as Record<string, boolean>;
      expect(d.isActive).toBe(true);
      expect(d.isCurrent).toBe(false);
      expect(d.isPlayed).toBe(false);
      expect(d.showTrail).toBe(false);
    }
  });

  it('marks steps as active/current/played based on playback state', () => {
    const out = buildFlowLayout({
      steps: [
        step(1, 'a', 'a', 'b', 'b'),
        step(2, 'b', 'b', 'c', 'c'),
        step(3, 'c', 'c', 'd', 'd'),
      ],
      playback: { currentStep: 2, isPlaying: true },
    });
    const edgeData = out.edges.map((e) => e.data as Record<string, boolean>);
    expect(edgeData[0]).toMatchObject({ isActive: true, isPlayed: true, isCurrent: false });
    expect(edgeData[1]).toMatchObject({ isActive: true, isPlayed: false, isCurrent: true });
    expect(edgeData[2]).toMatchObject({ isActive: false, isPlayed: false, isCurrent: false });
  });

  it('marks self-call edges with isSelf and offsets target anchor Y', () => {
    const out = buildFlowLayout({
      steps: [
        step(1, 'api', 'api', 'api', 'api'),         // self-call
        step(2, 'api', 'api', 'user', 'user'),       // regular
      ],
    });
    const selfEdge = out.edges.find((e) => e.id === 'step-1');
    const regEdge = out.edges.find((e) => e.id === 'step-2');
    expect((selfEdge?.data as { isSelf: boolean }).isSelf).toBe(true);
    expect((regEdge?.data as { isSelf: boolean }).isSelf).toBe(false);

    // Self-call's target anchor should be placed lower than its source
    // anchor so StepEdge has vertical extent to draw the loop path.
    const srcAnchor = out.nodes.find((n) => n.id === 'step-src-1');
    const tgtAnchor = out.nodes.find((n) => n.id === 'step-tgt-1');
    expect(tgtAnchor?.position.y).toBeGreaterThan(srcAnchor?.position.y ?? 0);
  });

  it('reverses anchor handle orientation when target column is left of source', () => {
    const out = buildFlowLayout({
      steps: [
        step(1, 'a', 'a', 'b', 'b'), // forward (a→b)
        step(2, 'b', 'b', 'a', 'a'), // reverse (b→a)
      ],
    });
    const anchors = out.nodes.filter((n) => n.type === 'anchor');
    // Step 1 forward: both anchors use sourcePos=Right, targetPos=Left
    expect(anchors[0].sourcePosition).toBe('right');
    expect(anchors[0].targetPosition).toBe('left');
    // Step 2 reverse: both anchors flip to sourcePos=Left, targetPos=Right
    expect(anchors[2].sourcePosition).toBe('left');
    expect(anchors[2].targetPosition).toBe('right');
  });

  it('attaches service-level violations only to the first step in each service', () => {
    const violations = new Map<string, { id: string; severity: string }[]>([
      ['service::user', [{ id: 'v1', severity: 'high' }]],
    ]);
    const out = buildFlowLayout({
      steps: [
        step(1, 'api', 'api', 'user', 'handler', 'call', { targetMethod: 'a' }),
        step(2, 'api', 'api', 'user', 'handler', 'call', { targetMethod: 'b' }),
      ],
      violationsByTarget: violations,
      includeStepDetails: true,
    });
    const details = out.nodes.filter((n) => n.type === 'stepDetail');
    expect((details[0].data as { violations: unknown[] }).violations).toHaveLength(1);
    expect((details[1].data as { violations: unknown[] }).violations).toHaveLength(0);
  });

  it('uses the taller row height when any step has a description', () => {
    const withoutDesc = buildFlowLayout({
      steps: [step(1, 'a', 'a', 'b', 'b'), step(2, 'a', 'a', 'b', 'b')],
    });
    const withDesc = buildFlowLayout({
      steps: [
        step(1, 'a', 'a', 'b', 'b'),
        step(2, 'a', 'a', 'b', 'b', 'call', { dataDescription: 'x' }),
      ],
    });
    expect(withDesc.height).toBeGreaterThan(withoutDesc.height);
  });
});
