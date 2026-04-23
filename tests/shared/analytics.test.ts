import { describe, it, expect } from 'vitest';
import {
  TrendDataPointSchema,
  TrendResponseSchema,
  BreakdownResponseSchema,
  TopOffenderSchema,
  TopOffendersResponseSchema,
  ResolutionResponseSchema,
} from '../../packages/shared/src/types/analytics';

describe('Analytics shared types (Zod schemas)', () => {
  describe('TrendDataPointSchema', () => {
    it('accepts a valid trend data point', () => {
      const point = {
        analysisId: '123e4567-e89b-12d3-a456-426614174000',
        date: '2026-03-21T12:00:00.000Z',
        branch: 'main',
        total: 10,
        new: 3,
        unchanged: 5,
        resolved: 2,
        critical: 1,
        high: 2,
        medium: 3,
        low: 3,
        info: 1,
      };
      expect(TrendDataPointSchema.parse(point)).toEqual(point);
    });

    it('accepts null branch', () => {
      const point = {
        analysisId: 'abc',
        date: '2026-03-21T12:00:00.000Z',
        branch: null,
        total: 0,
        new: 0,
        unchanged: 0,
        resolved: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      };
      expect(TrendDataPointSchema.parse(point).branch).toBeNull();
    });

    it('rejects missing fields', () => {
      expect(() => TrendDataPointSchema.parse({ analysisId: 'abc' })).toThrow();
    });
  });

  describe('TrendResponseSchema', () => {
    it('accepts empty points array', () => {
      const result = TrendResponseSchema.parse({ points: [] });
      expect(result.points).toEqual([]);
    });

    it('accepts valid points array', () => {
      const result = TrendResponseSchema.parse({
        points: [
          {
            analysisId: 'a1',
            date: '2026-03-20T10:00:00Z',
            branch: 'main',
            total: 5,
            new: 2,
            unchanged: 2,
            resolved: 1,
            critical: 0,
            high: 1,
            medium: 2,
            low: 1,
            info: 1,
          },
          {
            analysisId: 'a2',
            date: '2026-03-21T10:00:00Z',
            branch: 'main',
            total: 4,
            new: 1,
            unchanged: 2,
            resolved: 1,
            critical: 0,
            high: 0,
            medium: 2,
            low: 1,
            info: 1,
          },
        ],
      });
      expect(result.points).toHaveLength(2);
    });
  });

  describe('BreakdownResponseSchema', () => {
    it('accepts valid breakdown', () => {
      const data = {
        byCategory: { security: 3, bugs: 2, 'code-quality': 5 },
        bySeverity: { critical: 1, high: 2, medium: 4, low: 3 },
        total: 10,
      };
      expect(BreakdownResponseSchema.parse(data)).toEqual(data);
    });

    it('accepts empty breakdown', () => {
      const data = { byCategory: {}, bySeverity: {}, total: 0 };
      expect(BreakdownResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe('TopOffenderSchema', () => {
    it('accepts service offender', () => {
      const offender = {
        id: 'svc-1',
        name: 'UserService',
        kind: 'service' as const,
        violationCount: 5,
        criticalCount: 1,
        highCount: 2,
      };
      expect(TopOffenderSchema.parse(offender)).toEqual(offender);
    });

    it('accepts module offender', () => {
      const offender = {
        id: 'mod-1',
        name: 'AuthModule',
        kind: 'module' as const,
        violationCount: 3,
        criticalCount: 0,
        highCount: 1,
      };
      expect(TopOffenderSchema.parse(offender)).toEqual(offender);
    });

    it('rejects invalid kind', () => {
      expect(() =>
        TopOffenderSchema.parse({
          id: 'x',
          name: 'X',
          kind: 'function',
          violationCount: 0,
          criticalCount: 0,
          highCount: 0,
        }),
      ).toThrow();
    });
  });

  describe('TopOffendersResponseSchema', () => {
    it('accepts valid response', () => {
      const data = {
        offenders: [
          { id: 's1', name: 'Svc', kind: 'service' as const, violationCount: 3, criticalCount: 0, highCount: 1 },
        ],
        analysisId: 'a1',
      };
      expect(TopOffendersResponseSchema.parse(data).offenders).toHaveLength(1);
    });

    it('accepts empty offenders', () => {
      const data = { offenders: [], analysisId: 'a1' };
      expect(TopOffendersResponseSchema.parse(data).offenders).toEqual([]);
    });
  });

  describe('ResolutionResponseSchema', () => {
    it('accepts valid resolution data', () => {
      const data = {
        avgTimeToResolveMs: 86400000,
        totalResolved: 15,
        totalActive: 10,
        resolutionRate: 0.6,
        staleCount: 3,
        staleDays: 7,
      };
      expect(ResolutionResponseSchema.parse(data)).toEqual(data);
    });

    it('accepts null avgTimeToResolveMs', () => {
      const data = {
        avgTimeToResolveMs: null,
        totalResolved: 0,
        totalActive: 5,
        resolutionRate: 0,
        staleCount: 0,
        staleDays: 7,
      };
      expect(ResolutionResponseSchema.parse(data).avgTimeToResolveMs).toBeNull();
    });
  });
});

describe('Analytics computation logic (unit)', () => {
  // Simulate the aggregation logic used by the analytics service

  interface ViolationRow {
    analysisId: string;
    status: string;
    severity: string;
    type: string;
    ruleKey?: string;
  }

  function computeTrendPoints(
    analyses: { id: string; createdAt: string; branch: string | null }[],
    violations: ViolationRow[],
  ) {
    const countMap = new Map<string, Map<string, number>>();
    for (const v of violations) {
      if (!countMap.has(v.analysisId)) countMap.set(v.analysisId, new Map());
      const m = countMap.get(v.analysisId)!;
      m.set(`status:${v.status}`, (m.get(`status:${v.status}`) ?? 0) + 1);
      m.set(`severity:${v.severity}`, (m.get(`severity:${v.severity}`) ?? 0) + 1);
      m.set('total', (m.get('total') ?? 0) + 1);
    }

    return analyses.map((a) => {
      const m = countMap.get(a.id) ?? new Map<string, number>();
      return {
        analysisId: a.id,
        date: a.createdAt,
        branch: a.branch,
        total: m.get('total') ?? 0,
        new: m.get('status:new') ?? 0,
        unchanged: m.get('status:unchanged') ?? 0,
        resolved: m.get('status:resolved') ?? 0,
        critical: m.get('severity:critical') ?? 0,
        high: m.get('severity:high') ?? 0,
        medium: m.get('severity:medium') ?? 0,
        low: m.get('severity:low') ?? 0,
        info: m.get('severity:info') ?? 0,
      };
    });
  }

  function computeBreakdown(violations: ViolationRow[]) {
    const active = violations.filter((v) => v.status === 'new' || v.status === 'unchanged');
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const v of active) {
      // Category is the first segment of ruleKey (e.g. 'security/deterministic/foo' → 'security').
      const category = (v.ruleKey ?? '').split('/')[0];
      if (category) byCategory[category] = (byCategory[category] ?? 0) + 1;
      bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    }
    return { byCategory, bySeverity, total: active.length };
  }

  function computeResolutionRate(resolved: number, active: number) {
    const total = resolved + active;
    return total > 0 ? resolved / total : 0;
  }

  it('trend: single analysis with all new violations', () => {
    const points = computeTrendPoints(
      [{ id: 'a1', createdAt: '2026-03-21T10:00:00Z', branch: 'main' }],
      [
        { analysisId: 'a1', status: 'new', severity: 'high', type: 'service' },
        { analysisId: 'a1', status: 'new', severity: 'medium', type: 'module' },
      ],
    );
    expect(points).toHaveLength(1);
    expect(points[0].total).toBe(2);
    expect(points[0].new).toBe(2);
    expect(points[0].unchanged).toBe(0);
    expect(points[0].resolved).toBe(0);
    expect(points[0].high).toBe(1);
    expect(points[0].medium).toBe(1);
  });

  it('trend: multiple analyses showing improvement', () => {
    const points = computeTrendPoints(
      [
        { id: 'a1', createdAt: '2026-03-20T10:00:00Z', branch: 'main' },
        { id: 'a2', createdAt: '2026-03-21T10:00:00Z', branch: 'main' },
      ],
      [
        // First analysis: 3 new
        { analysisId: 'a1', status: 'new', severity: 'high', type: 'service' },
        { analysisId: 'a1', status: 'new', severity: 'medium', type: 'module' },
        { analysisId: 'a1', status: 'new', severity: 'low', type: 'code' },
        // Second analysis: 1 unchanged, 1 resolved, 1 new
        { analysisId: 'a2', status: 'unchanged', severity: 'high', type: 'service' },
        { analysisId: 'a2', status: 'resolved', severity: 'medium', type: 'module' },
        { analysisId: 'a2', status: 'new', severity: 'low', type: 'code' },
      ],
    );

    expect(points[0].total).toBe(3);
    expect(points[0].new).toBe(3);
    expect(points[1].total).toBe(3);
    expect(points[1].new).toBe(1);
    expect(points[1].unchanged).toBe(1);
    expect(points[1].resolved).toBe(1);
  });

  it('trend: empty analysis returns zeros', () => {
    const points = computeTrendPoints(
      [{ id: 'a1', createdAt: '2026-03-21T10:00:00Z', branch: null }],
      [],
    );
    expect(points[0].total).toBe(0);
    expect(points[0].branch).toBeNull();
  });

  it('breakdown: only active violations counted', () => {
    const result = computeBreakdown([
      { analysisId: 'a1', status: 'new', severity: 'high', type: 'service', ruleKey: 'security/deterministic/foo' },
      { analysisId: 'a1', status: 'unchanged', severity: 'medium', type: 'module', ruleKey: 'bugs/deterministic/bar' },
      { analysisId: 'a1', status: 'resolved', severity: 'low', type: 'code', ruleKey: 'code-quality/llm/baz' },
    ]);
    expect(result.total).toBe(2); // resolved excluded
    expect(result.byCategory).toEqual({ security: 1, bugs: 1 });
    expect(result.bySeverity).toEqual({ high: 1, medium: 1 });
  });

  it('breakdown: empty when no violations', () => {
    const result = computeBreakdown([]);
    expect(result.total).toBe(0);
    expect(result.byCategory).toEqual({});
  });

  it('resolution rate: basic calculation', () => {
    expect(computeResolutionRate(6, 4)).toBe(0.6);
    expect(computeResolutionRate(0, 5)).toBe(0);
    expect(computeResolutionRate(0, 0)).toBe(0);
    expect(computeResolutionRate(10, 0)).toBe(1);
  });
});
