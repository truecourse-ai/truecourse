import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, KIND_CAPABILITIES } from '../../packages/contract-extractor/src/prompt.js';
import { renderGrammarKeywordReference } from '../../packages/contract-verifier/src/parser-ohm/keyword-sets.js';

describe('SYSTEM_PROMPT — grammar-derived closed keyword sets', () => {
  it('stays a plain string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it('embeds the closed-keyword-sets section with its CLOSED framing', () => {
    expect(SYSTEM_PROMPT).toContain('# Closed keyword sets');
    // The framing rule: closed sets + the unenforceable-obligation escape hatch.
    expect(SYSTEM_PROMPT).toMatch(/CLOSED[\s\S]*unenforceable-obligation/);
  });

  it('embeds the generated reference verbatim', () => {
    const ref = renderGrammarKeywordReference();
    expect(SYSTEM_PROMPT).toContain(ref);
  });

  it('surfaces the two via channels as the only FldExpChannel keywords', () => {
    expect(SYSTEM_PROMPT).toContain('FldExpChannel: query-select | api-response');
  });

  it('surfaces constraint among the operation-field modifiers', () => {
    const line = SYSTEM_PROMPT.split('\n').find((l) => l.startsWith('OpFieldMod:'));
    expect(line).toBeDefined();
    expect(line).toContain('constraint');
  });
});

describe('KIND_CAPABILITIES — structural limits', () => {
  it('keeps the exact per-line "- <KindName> — <description>" format', () => {
    const lines = KIND_CAPABILITIES.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      expect(line).toMatch(/^- ([A-Za-z]+) — /);
    }
    // Kind names remain parseable by the downstream `/^- ([A-Za-z]+) —/` reader.
    const kinds = lines.map((l) => l.match(/^- ([A-Za-z]+) —/)?.[1]);
    expect(kinds).toContain('FieldExposure');
    expect(kinds).toContain('Operation');
    expect(kinds).toContain('UnenforceableObligation');
  });

  it('states the FieldExposure channel limit (headers/metadata are not a FieldExposure)', () => {
    const line = KIND_CAPABILITIES.split('\n').find((l) => l.startsWith('- FieldExposure —'));
    expect(line).toBeDefined();
    expect(line).toContain('query-select');
    expect(line).toContain('api-response');
    expect(line).toMatch(/header/i);
    expect(line).toMatch(/NamedConstant/);
    expect(line).toMatch(/UnenforceableObligation/);
  });
});
