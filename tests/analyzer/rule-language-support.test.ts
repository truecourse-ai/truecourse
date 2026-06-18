/**
 * Rule language-support matrix enforcement.
 *
 * The matrix is the auditable coverage claim: every rule has a status for
 * every analysis language, and statuses can't drift from visitor reality —
 * a rule can't silently lack a port (`unsupported` requires saying so) and a
 * disposition can't outlive a later port (`not-applicable` with a visitor is
 * an error).
 */

import { describe, it, expect } from 'vitest';
import { ANALYSIS_LANGUAGES, type AnalysisLanguage } from '../../packages/shared/src/types';
import { getAllDefaultRules } from '../../packages/analyzer/src/rule-engine';
import {
  ALL_CODE_VISITORS,
  RULE_LANGUAGE_DISPOSITIONS,
  LANGUAGE_FAMILY,
  UNIVERSAL_VISITOR_FAMILIES,
  summarizeLanguageSupport,
} from '../../packages/analyzer/src/rules/index';

const rules = getAllDefaultRules();

// ruleKey → families with a visitor; universal visitors (no languages field)
// cover the audited family set
const visitorFamilies = new Map<string, Set<AnalysisLanguage>>();
for (const visitor of ALL_CODE_VISITORS) {
  if (!visitorFamilies.has(visitor.ruleKey)) visitorFamilies.set(visitor.ruleKey, new Set());
  const families = visitor.languages
    ? visitor.languages.map((l) => LANGUAGE_FAMILY[l])
    : [...UNIVERSAL_VISITOR_FAMILIES];
  for (const family of families) visitorFamilies.get(visitor.ruleKey)!.add(family);
}

describe('rule language-support matrix', () => {
  it('every rule declares a status for every analysis language', () => {
    const missing: string[] = [];
    for (const rule of rules) {
      for (const language of ANALYSIS_LANGUAGES) {
        if (!rule.languageSupport?.[language]) {
          missing.push(`${rule.key} → ${language}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('supported/partial code rules have a visitor for that language', () => {
    const phantom: string[] = [];
    for (const rule of rules) {
      if (rule.category !== 'code' || rule.type !== 'deterministic') continue;
      for (const language of ANALYSIS_LANGUAGES) {
        const entry = rule.languageSupport?.[language];
        if (!entry || (entry.status !== 'supported' && entry.status !== 'partial')) continue;
        if (!visitorFamilies.get(rule.key)?.has(language)) {
          phantom.push(`${rule.key} claims ${entry.status} for ${language} but has no visitor`);
        }
      }
    }
    expect(phantom).toEqual([]);
  });

  it('not-applicable/unsupported rules have NO visitor for that language', () => {
    const stale: string[] = [];
    for (const rule of rules) {
      if (rule.category !== 'code' || rule.type !== 'deterministic') continue;
      for (const language of ANALYSIS_LANGUAGES) {
        const entry = rule.languageSupport?.[language];
        if (!entry || (entry.status !== 'not-applicable' && entry.status !== 'unsupported')) continue;
        if (visitorFamilies.get(rule.key)?.has(language)) {
          stale.push(`${rule.key} claims ${entry.status} for ${language} but a visitor exists — update the disposition`);
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it('partial, not-applicable, and unsupported statuses carry a reason', () => {
    const unexplained: string[] = [];
    for (const rule of rules) {
      for (const language of ANALYSIS_LANGUAGES) {
        const entry = rule.languageSupport?.[language];
        if (!entry || entry.status === 'supported') continue;
        if (!entry.reason?.trim()) {
          unexplained.push(`${rule.key} → ${language} (${entry.status})`);
        }
      }
    }
    expect(unexplained).toEqual([]);
  });

  it('curated dispositions reference real rule keys', () => {
    const ruleKeys = new Set(rules.map((r) => r.key));
    const orphans = Object.keys(RULE_LANGUAGE_DISPOSITIONS).filter((key) => !ruleKeys.has(key));
    expect(orphans).toEqual([]);
  });

  it('reports a sane per-language summary', () => {
    const summary = summarizeLanguageSupport(rules);
    console.log('Language support summary:', JSON.stringify(summary));

    for (const language of ANALYSIS_LANGUAGES) {
      const counts = summary[language];
      const total = counts.supported + counts.partial + counts['not-applicable'] + counts.unsupported;
      expect(total).toBe(rules.length);
    }
    // Every language has real coverage; C# trails until its visitor port lands
    expect(summary.javascript.supported).toBeGreaterThan(0);
    expect(summary.python.supported).toBeGreaterThan(0);
    expect(summary.csharp.supported).toBeGreaterThan(0);
    expect(summary.csharp.supported).toBeLessThanOrEqual(summary.javascript.supported);
    expect(summary.csharp.supported).toBeLessThanOrEqual(summary.python.supported);
  });
});
