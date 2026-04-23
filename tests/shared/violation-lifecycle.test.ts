import { describe, it, expect } from 'vitest';
import { ViolationStatusSchema } from '../../packages/shared/src/types/violations';

describe('ViolationStatusSchema', () => {
  it('accepts valid statuses', () => {
    expect(ViolationStatusSchema.parse('new')).toBe('new');
    expect(ViolationStatusSchema.parse('unchanged')).toBe('unchanged');
    expect(ViolationStatusSchema.parse('resolved')).toBe('resolved');
  });

  it('rejects invalid statuses', () => {
    expect(() => ViolationStatusSchema.parse('active')).toThrow();
    expect(() => ViolationStatusSchema.parse('')).toThrow();
    expect(() => ViolationStatusSchema.parse(null)).toThrow();
  });
});

describe('violation lifecycle logic (unit)', () => {
  // Simulate the lifecycle classification logic used by persistViolationsWithLifecycle

  interface ActiveViolation {
    id: string;
    title: string;
    type: string;
    content: string;
    severity: string;
  }

  interface NewViolation {
    title: string;
    type: string;
    content: string;
    severity: string;
  }

  function classifyViolations(
    previousActive: ActiveViolation[],
    resolvedIds: string[],
    newViolations: NewViolation[],
  ) {
    const resolvedSet = new Set(resolvedIds);
    const newTitles = new Set(newViolations.map((v) => v.title.toLowerCase().trim()));

    const result: { id?: string; title: string; status: 'new' | 'unchanged' | 'resolved'; previousId?: string }[] = [];

    for (const prev of previousActive) {
      if (resolvedSet.has(prev.id)) {
        result.push({ title: prev.title, status: 'resolved', previousId: prev.id });
      } else if (!newTitles.has(prev.title.toLowerCase().trim())) {
        result.push({ title: prev.title, status: 'unchanged', previousId: prev.id });
      }
      // If title matches a new violation, skip (replaced by new one)
    }

    for (const v of newViolations) {
      result.push({ title: v.title, status: 'new' });
    }

    return result;
  }

  it('first analysis: all violations are new', () => {
    const result = classifyViolations(
      [],
      [],
      [
        { title: 'Circular dependency', type: 'service', content: 'A->B->A', severity: 'high' },
        { title: 'Missing index', type: 'database', content: 'No index on users.email', severity: 'medium' },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result.every((v) => v.status === 'new')).toBe(true);
  });

  it('second analysis with no changes: all carry forward as unchanged', () => {
    const previous: ActiveViolation[] = [
      { id: 'v1', title: 'Circular dependency', type: 'service', content: 'A->B->A', severity: 'high' },
      { id: 'v2', title: 'Missing index', type: 'database', content: 'No index on users.email', severity: 'medium' },
    ];

    const result = classifyViolations(previous, [], []);

    expect(result).toHaveLength(2);
    expect(result.every((v) => v.status === 'unchanged')).toBe(true);
    expect(result[0].previousId).toBe('v1');
    expect(result[1].previousId).toBe('v2');
  });

  it('resolving a violation marks it as resolved', () => {
    const previous: ActiveViolation[] = [
      { id: 'v1', title: 'Circular dependency', type: 'service', content: 'A->B->A', severity: 'high' },
      { id: 'v2', title: 'Missing index', type: 'database', content: 'No index', severity: 'medium' },
    ];

    const result = classifyViolations(previous, ['v1'], []);

    expect(result).toHaveLength(2);
    const resolved = result.find((v) => v.status === 'resolved');
    const unchanged = result.find((v) => v.status === 'unchanged');
    expect(resolved?.title).toBe('Circular dependency');
    expect(resolved?.previousId).toBe('v1');
    expect(unchanged?.title).toBe('Missing index');
  });

  it('new violation appears alongside unchanged ones', () => {
    const previous: ActiveViolation[] = [
      { id: 'v1', title: 'Missing index', type: 'database', content: 'No index', severity: 'medium' },
    ];

    const result = classifyViolations(
      previous,
      [],
      [{ title: 'God class detected', type: 'module', content: 'UserService too large', severity: 'high' }],
    );

    expect(result).toHaveLength(2);
    expect(result.find((v) => v.status === 'unchanged')?.title).toBe('Missing index');
    expect(result.find((v) => v.status === 'new')?.title).toBe('God class detected');
  });

  it('resolving all violations leaves only resolved statuses', () => {
    const previous: ActiveViolation[] = [
      { id: 'v1', title: 'Issue A', type: 'service', content: 'A', severity: 'high' },
      { id: 'v2', title: 'Issue B', type: 'service', content: 'B', severity: 'medium' },
    ];

    const result = classifyViolations(previous, ['v1', 'v2'], []);

    expect(result).toHaveLength(2);
    expect(result.every((v) => v.status === 'resolved')).toBe(true);
  });

  it('replaced violation (same title) is not carried forward as unchanged', () => {
    const previous: ActiveViolation[] = [
      { id: 'v1', title: 'High coupling: 4 dependencies', type: 'service', content: 'old', severity: 'high' },
    ];

    // LLM resolved the old one and created a new one with updated count
    const result = classifyViolations(
      previous,
      ['v1'],
      [{ title: 'High coupling: 5 dependencies', type: 'service', content: 'updated', severity: 'high' }],
    );

    expect(result).toHaveLength(2);
    expect(result.find((v) => v.status === 'resolved')?.title).toBe('High coupling: 4 dependencies');
    expect(result.find((v) => v.status === 'new')?.title).toBe('High coupling: 5 dependencies');
  });

  it('violation with matching title to a new one is replaced (not duplicated)', () => {
    const previous: ActiveViolation[] = [
      { id: 'v1', title: 'Circular dependency', type: 'service', content: 'A->B->A', severity: 'high' },
      { id: 'v2', title: 'Missing index', type: 'database', content: 'No index', severity: 'medium' },
    ];

    // New violation has same title as v1 — v1 should be dropped (replaced), not unchanged
    const result = classifyViolations(
      previous,
      [],
      [{ title: 'Circular dependency', type: 'service', content: 'Updated description', severity: 'high' }],
    );

    expect(result).toHaveLength(2);
    // v2 unchanged, new "Circular dependency" replaces v1
    expect(result.find((v) => v.status === 'unchanged')?.title).toBe('Missing index');
    expect(result.find((v) => v.status === 'new')?.title).toBe('Circular dependency');
    // v1 should NOT appear as unchanged
    expect(result.filter((v) => v.status === 'unchanged')).toHaveLength(1);
  });

  it('title matching is case-insensitive and trim-aware', () => {
    const previous: ActiveViolation[] = [
      { id: 'v1', title: '  Circular Dependency  ', type: 'service', content: 'old', severity: 'high' },
    ];

    const result = classifyViolations(
      previous,
      [],
      [{ title: 'circular dependency', type: 'service', content: 'new', severity: 'high' }],
    );

    // Should be treated as a replacement, not a duplicate
    expect(result.filter((v) => v.status === 'unchanged')).toHaveLength(0);
    expect(result.find((v) => v.status === 'new')?.title).toBe('circular dependency');
  });
});

describe('code violation lifecycle logic (unit)', () => {
  interface ActiveCodeViolation {
    id: string;
    ruleKey: string;
    filePath: string;
    title: string;
  }

  interface CurrentCodeViolation {
    ruleKey: string;
    filePath: string;
    title: string;
  }

  function classifyCodeViolations(
    previous: ActiveCodeViolation[],
    current: CurrentCodeViolation[],
  ) {
    const currentKeys = new Set(current.map((v) => `${v.ruleKey}::${v.filePath}`));
    const previousByKey = new Map(previous.map((v) => [`${v.ruleKey}::${v.filePath}`, v]));

    const result: { title: string; status: 'new' | 'unchanged' | 'resolved'; previousId?: string }[] = [];

    // Previous not in current → resolved
    for (const prev of previous) {
      const key = `${prev.ruleKey}::${prev.filePath}`;
      if (!currentKeys.has(key)) {
        result.push({ title: prev.title, status: 'resolved', previousId: prev.id });
      }
    }

    // Current violations
    for (const cv of current) {
      const key = `${cv.ruleKey}::${cv.filePath}`;
      const prev = previousByKey.get(key);
      if (prev) {
        result.push({ title: cv.title, status: 'unchanged', previousId: prev.id });
      } else {
        result.push({ title: cv.title, status: 'new' });
      }
    }

    return result;
  }

  it('first analysis: all code violations are new', () => {
    const result = classifyCodeViolations(
      [],
      [
        { ruleKey: 'no-unused-vars', filePath: '/src/a.ts', title: 'Unused var' },
        { ruleKey: 'complexity', filePath: '/src/b.ts', title: 'High complexity' },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result.every((v) => v.status === 'new')).toBe(true);
  });

  it('matching ruleKey + filePath → unchanged', () => {
    const result = classifyCodeViolations(
      [{ id: 'cv1', ruleKey: 'no-unused-vars', filePath: '/src/a.ts', title: 'Unused var' }],
      [{ ruleKey: 'no-unused-vars', filePath: '/src/a.ts', title: 'Unused var (updated)' }],
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('unchanged');
    expect(result[0].previousId).toBe('cv1');
  });

  it('removed code violation → resolved', () => {
    const result = classifyCodeViolations(
      [
        { id: 'cv1', ruleKey: 'no-unused-vars', filePath: '/src/a.ts', title: 'Unused var' },
        { id: 'cv2', ruleKey: 'complexity', filePath: '/src/b.ts', title: 'High complexity' },
      ],
      [{ ruleKey: 'complexity', filePath: '/src/b.ts', title: 'High complexity' }],
    );

    expect(result).toHaveLength(2);
    expect(result.find((v) => v.status === 'resolved')?.previousId).toBe('cv1');
    expect(result.find((v) => v.status === 'unchanged')?.previousId).toBe('cv2');
  });

  it('same rule in different files are treated as separate violations', () => {
    const result = classifyCodeViolations(
      [{ id: 'cv1', ruleKey: 'complexity', filePath: '/src/a.ts', title: 'Complex A' }],
      [
        { ruleKey: 'complexity', filePath: '/src/a.ts', title: 'Complex A' },
        { ruleKey: 'complexity', filePath: '/src/b.ts', title: 'Complex B' },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result.find((v) => v.status === 'unchanged')?.title).toBe('Complex A');
    expect(result.find((v) => v.status === 'new')?.title).toBe('Complex B');
  });

  it('different rule in same file are treated as separate violations', () => {
    const result = classifyCodeViolations(
      [{ id: 'cv1', ruleKey: 'complexity', filePath: '/src/a.ts', title: 'Complex' }],
      [
        { ruleKey: 'complexity', filePath: '/src/a.ts', title: 'Complex' },
        { ruleKey: 'no-unused-vars', filePath: '/src/a.ts', title: 'Unused' },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result.find((v) => v.status === 'unchanged')?.title).toBe('Complex');
    expect(result.find((v) => v.status === 'new')?.title).toBe('Unused');
  });

  it('all violations resolved when current is empty', () => {
    const result = classifyCodeViolations(
      [
        { id: 'cv1', ruleKey: 'complexity', filePath: '/src/a.ts', title: 'Complex' },
        { id: 'cv2', ruleKey: 'no-unused-vars', filePath: '/src/b.ts', title: 'Unused' },
      ],
      [],
    );

    expect(result).toHaveLength(2);
    expect(result.every((v) => v.status === 'resolved')).toBe(true);
  });
});
