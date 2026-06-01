import { describe, it, expect } from 'vitest';
import { parseFile } from '../../packages/contract-verifier/src/parser/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { ArchitectureDecisionContract } from '../../packages/contract-verifier/src/types/index.js';

function lift(src: string): ArchitectureDecisionContract {
  const r = resolve([parseFile('a.tc', src)]);
  if (r.errors.length > 0) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.index.values().next().value!.contract as ArchitectureDecisionContract;
}

describe('ArchitectureDecision lifter', () => {
  it('lifts category, chosen, and reason', () => {
    const c = lift(`architecture-decision data-store.postgres {
      origin "docs/adr/ADR-001.md" "Decision" 10..15
      category data-store
      chosen postgres
      reason "Full-text search via tsvector"
    }`);
    expect(c).toEqual({
      category: 'data-store',
      chosen: 'postgres',
      reason: 'Full-text search via tsvector',
    });
  });

  it('lifts rejected-alternatives', () => {
    const c = lift(`architecture-decision storage.postgres {
      category data-store
      chosen postgres
      reason "r"
      rejected-alternatives [mongodb, mysql]
    }`);
    expect(c.rejectedAlternatives).toEqual(['mongodb', 'mysql']);
  });

  it('lifts a scope path-glob', () => {
    const c = lift(`architecture-decision frontend.react {
      category frontend-framework
      chosen react
      reason "component reuse"
      scope { path-glob "app/**" }
    }`);
    expect(c.scope).toEqual({ pathGlob: 'app/**' });
  });

  it('indexes the artifact under its ArchitectureDecision identity', () => {
    const r = resolve([parseFile('a.tc', `architecture-decision messaging.kafka {
      category messaging
      chosen kafka
      reason "ordering + replay"
    }`)]);
    expect(r.errors).toEqual([]);
    expect(r.index.has('ArchitectureDecision:messaging.kafka')).toBe(true);
  });

  it('falls back to data-store for an unknown category rather than throwing', () => {
    const c = lift(`architecture-decision x.y {
      category not-a-real-category
      chosen whatever
      reason "r"
    }`);
    expect(c.category).toBe('data-store');
  });
});
