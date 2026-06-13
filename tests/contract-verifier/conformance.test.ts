/**
 * Conformance linter — the 8 context-sensitive completeness rules that used
 * to live as regex-on-tcSource inside the contract-extractor's repair pass.
 *
 * Each rule is proven twice: it FIRES on a deficient artifact and is SILENT
 * on a complete one. Artifacts are authored as realistic `.tc`, parsed by the
 * strict ohm grammar (`parseTcFile`) and run through the resolver, then linted
 * over the typed/resolved contracts — never over raw text.
 *
 * Behavior preservation: the deficiencies asserted here are exactly the ones
 * that triggered a repair re-prompt before (`repair.ts rulesFor`), and the
 * `detail` strings are byte-identical to the repair messages so the
 * extractor's re-prompt content is unchanged.
 */

import { describe, it, expect } from 'vitest';
import { parseTcFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import { lintConformance } from '../../packages/contract-verifier/src/conformance/index.js';

/** Parse + resolve one `.tc` source, then return the conformance findings. */
function lint(src: string) {
  const fileNode = parseTcFile('test.tc', src);
  const resolution = resolve([fileNode]);
  expect(resolution.errors).toEqual([]);
  return lintConformance(resolution.index.values());
}

function details(src: string): string[] {
  return lint(src).map((f) => f.detail);
}

describe('conformance linter — authorization-rule', () => {
  it('flags an empty applies-to (no enumerated operations)', () => {
    const found = lint(`authorization-rule order.owner {
  origin SPEC.md "Authz" 1..3
  applies-to { }
  predicate "user.id == order.userId"
  on-violation { status 403 error-code forbidden }
}`);
    expect(found).toHaveLength(1);
    expect(found[0].artifactKey).toBe('AuthorizationRule:order.owner');
    expect(found[0].kind).toBe('incomplete');
    expect(found[0].detail).toContain('applies-to uses `tag <slug>` only');
  });

  it('flags a missing predicate', () => {
    const found = details(`authorization-rule order.owner {
  origin SPEC.md "Authz" 1..3
  applies-to { operations [Operation:"GET /api/orders/{id}"] }
  on-violation { status 403 error-code forbidden }
}`);
    expect(found).toEqual([
      'missing `predicate "..."` — the rule has no logical condition to evaluate.',
    ]);
  });

  it('flags a missing on-violation', () => {
    const found = details(`authorization-rule order.owner {
  origin SPEC.md "Authz" 1..3
  applies-to { operations [Operation:"GET /api/orders/{id}"] }
  predicate "user.id == order.userId"
}`);
    expect(found).toEqual([
      'missing `on-violation { status ... }` — the comparator needs to know what response a violation produces.',
    ]);
  });

  it('passes a complete authorization-rule', () => {
    expect(
      details(`authorization-rule order.owner {
  origin SPEC.md "Authz" 1..3
  applies-to { operations [Operation:"GET /api/orders/{id}"] }
  predicate "user.id == order.userId"
  on-violation { status 403 error-code forbidden }
}`),
    ).toEqual([]);
  });
});

describe('conformance linter — auth-requirement', () => {
  it('flags a missing on-violation', () => {
    const found = details(`auth-requirement auth.bearer.api {
  origin SPEC.md "Auth" 1..3
  scheme Bearer
  selector path-glob "/api/orders/**"
}`);
    expect(found).toEqual([
      'missing `on-violation { status ... error-code ... body ErrorEnvelope:... }`.',
    ]);
  });

  it('flags a required-role artifact with a broad path-glob selector', () => {
    const found = details(`auth-requirement auth.role.admin {
  origin SPEC.md "Auth" 1..4
  scheme Role
  required-role admin
  selector path-glob "/api/**"
  on-violation { status 403 error-code forbidden }
}`);
    expect(found).toEqual([
      'role-based auth-requirement uses a broad `path-glob "/api/**"` selector. ' +
        'Rewrite as `selector operations [Operation:"..."]` enumerating only the routes that require the role — ' +
        'broad globs cascade false-positive drifts to every matched operation.',
    ]);
  });

  it('flags a required-role artifact with no selector', () => {
    const found = details(`auth-requirement auth.role.admin {
  origin SPEC.md "Auth" 1..4
  scheme Role
  required-role admin
  on-violation { status 403 error-code forbidden }
}`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('role-based auth-requirement is missing a `selector`');
  });

  it('passes a required-role artifact with an enumerated operations selector', () => {
    expect(
      details(`auth-requirement auth.role.admin {
  origin SPEC.md "Auth" 1..4
  scheme Role
  required-role admin
  selector operations [Operation:"POST /api/customers", Operation:"DELETE /api/customers/{id}"]
  on-violation { status 403 error-code forbidden }
}`),
    ).toEqual([]);
  });

  it('does not apply the role-selector rule to a bearer requirement', () => {
    // A non-role (Bearer) requirement with a broad glob is fine — only the
    // role-selector rule rejects broad globs, and it only fires on roles.
    expect(
      details(`auth-requirement auth.bearer.api {
  origin SPEC.md "Auth" 1..3
  scheme Bearer
  selector path-glob "/api/**"
  on-violation { status 401 error-code unauthenticated }
}`),
    ).toEqual([]);
  });
});

describe('conformance linter — operation', () => {
  it('flags a 404-on-not_found response that lacks forbid status 200', () => {
    const found = lint(`operation GET "/api/orders/{id}" {
  origin SPEC.md "Orders" 1..6
  response 200 on success { body Entity:Order }
  response 404 on not_found {
    body envelope ErrorEnvelope:standard { error-code not_found }
  }
}`);
    expect(found).toHaveLength(1);
    expect(found[0].artifactKey).toBe('Operation:GET /api/orders/{id}');
    expect(found[0].detail).toContain('forbid status 200 when resource-missing');
  });

  it('passes a 404-on-not_found response with the forbid clause', () => {
    expect(
      details(`operation GET "/api/orders/{id}" {
  origin SPEC.md "Orders" 1..7
  response 200 on success { body Entity:Order }
  response 404 on not_found {
    forbid status 200 when resource-missing
    body envelope ErrorEnvelope:standard { error-code not_found }
  }
}`),
    ).toEqual([]);
  });

  it('does not flag an operation with no 404-on-not_found response', () => {
    expect(
      details(`operation GET "/api/orders/{id}" {
  origin SPEC.md "Orders" 1..4
  response 200 on success { body Entity:Order }
}`),
    ).toEqual([]);
  });
});

describe('conformance linter — effect-group', () => {
  it('flags a lifecycle group (>= 2 effects) with no forbids block', () => {
    const found = lint(`effect-group order.lifecycle {
  origin SPEC.md "Events" 1..12
  channel event-bus
  effect order.placed {
    emit-when { operation Operation:"POST /api/orders" on-status "201" }
  }
  effect order.paid {
    emit-when { operation Operation:"POST /api/orders/{id}/pay" on-status "200" }
  }
}`);
    expect(found).toHaveLength(1);
    expect(found[0].artifactKey).toBe('EffectGroup:order.lifecycle');
    expect(found[0].detail).toContain('effect-group has 2 effects but no `forbids { ... }` block');
  });

  it('passes a lifecycle group that declares a forbids block', () => {
    expect(
      details(`effect-group order.lifecycle {
  origin SPEC.md "Events" 1..14
  channel event-bus
  effect order.placed {
    emit-when { operation Operation:"POST /api/orders" on-status "201" }
  }
  effect order.paid {
    emit-when { operation Operation:"POST /api/orders/{id}/pay" on-status "200" }
  }
  forbids { forbid emission when-response-status [4xx, 5xx] }
}`),
    ).toEqual([]);
  });

  it('does not flag a single-effect group missing forbids', () => {
    expect(
      details(`effect-group order.single {
  origin SPEC.md "Events" 1..6
  channel event-bus
  effect order.placed {
    emit-when { operation Operation:"POST /api/orders" on-status "201" }
  }
}`),
    ).toEqual([]);
  });
});

describe('conformance linter — cross-reference / missing-artifact detection', () => {
  // Missing-artifact detection is NOT a conformance rule; it lives in the
  // resolver and is driven off `unresolvedRefs` (this is what repair.ts now
  // reads instead of its old CROSS_REF_PATTERNS regex scanner).
  it('the resolver enumerates an unresolved cross-reference', () => {
    const fileNode = parseTcFile('test.tc', `operation POST "/api/orders" {
  origin SPEC.md "Orders" 1..4
  response 401 inherits AuthRequirement:auth.bearer.api
}`);
    const resolution = resolve([fileNode]);
    expect(resolution.unresolvedRefs).toHaveLength(1);
    expect(resolution.unresolvedRefs[0].ref.type).toBe('AuthRequirement');
    expect(resolution.unresolvedRefs[0].ref.identity).toBe('auth.bearer.api');
    // The conformance linter stays silent on it — it only owns structural
    // completeness, not cross-reference resolution.
    expect(lintConformance(resolution.index.values())).toEqual([]);
  });
});
