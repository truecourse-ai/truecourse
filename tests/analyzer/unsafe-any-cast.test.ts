/**
 * Type-checked regression test for `unsafe-any-usage` false-positive
 * suppression. Unlike the inline type-aware tests (which run without a
 * TypeQueryService), this builds a real TS program over a committed fixture
 * whose `@angular/*` imports are intentionally unresolved — reproducing the
 * routine's node_modules-absent analysis where external types collapse to
 * `any`. The rule must ignore an `any` that only exists because a cast/inject
 * target type can't resolve, and still fire on developer-authored `any`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';
import { buildScopedCompilerOptions, createTypeQueryService } from '../../packages/analyzer/src/ts-compiler';
import type { CodeViolation } from '../../packages/shared/src/types/analysis';

const RULE = 'code-quality/deterministic/unsafe-any-usage';
const FIXTURE = new URL('../fixtures/type-any-cast', import.meta.url).pathname;

describe('code-quality/deterministic/unsafe-any-usage (type-checked)', () => {
  let matches: CodeViolation[];

  beforeAll(() => {
    const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);
    const app = `${FIXTURE}/src/app.ts`;
    const config = `${FIXTURE}/src/config.ts`;
    const scoped = buildScopedCompilerOptions(FIXTURE);
    const typeQuery = createTypeQueryService([app, config], scoped, FIXTURE);
    const src = readFileSync(app, 'utf-8');
    const tree = parseCode(src, 'typescript');
    matches = checkCodeRules(tree, app, src, enabledRules, 'typescript', typeQuery)
      .filter((v) => v.ruleKey === RULE);
  });

  it('flags only developer-authored any, not any from unresolved external types', () => {
    // Exactly two fires — `bad.whatever()` (`as any`, line 31) and
    // `evil.doThing()` (`: any` param, line 34). The `{} as HttpClient`,
    // `inject(HttpClient)`, imported-const and local-typed-cast lines above
    // stay silent even though the compiler sees them as `any`.
    const flaggedLines = matches.map((v) => v.lineStart).sort((a, b) => a - b);
    expect(flaggedLines).toEqual([31, 34]);
  });
});
