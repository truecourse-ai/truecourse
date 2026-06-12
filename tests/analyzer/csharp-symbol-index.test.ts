/**
 * C# symbol index — namespace-visibility resolution rules.
 *
 * The dependency-graph cases import statements can't express: same-namespace
 * references, ancestor-namespace lookup, global usings, aliases, using
 * static, internal visibility across project (assembly) boundaries, and
 * ambiguous names (skipped, never guessed).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import type { FileAnalysis } from '@truecourse/shared';
import { discoverFiles } from '../../packages/analyzer/src/file-discovery';
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer';
import { buildCSharpSymbolIndex, type CSharpSymbolIndex } from '../../packages/analyzer/src/symbol-index/csharp-symbol-index';

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'csharp-symbol-index');

function edge(index: CSharpSymbolIndex, source: string, target: string) {
  return index.edges.find(
    (e) => e.source === join(FIXTURE_PATH, source) && e.target === join(FIXTURE_PATH, target),
  );
}

describe('C# symbol index', () => {
  let index: CSharpSymbolIndex;

  beforeAll(async () => {
    const files = discoverFiles(FIXTURE_PATH);
    const results = await Promise.all(files.map((f) => analyzeFile(f)));
    const analyses = results.filter(Boolean) as FileAnalysis[];
    index = buildCSharpSymbolIndex(analyses, FIXTURE_PATH);
  });

  it('resolves same-namespace references with no using directive', () => {
    const e = edge(index, 'Billing/Invoicing/InvoiceCalculator.cs', 'Billing/Invoicing/Invoice.cs');
    expect(e).toBeDefined();
    expect(e!.importedNames).toContain('Invoice');
  });

  it('resolves references through ancestor namespaces', () => {
    // InvoiceCalculator (Billing.Invoicing) calls Auditor (Billing) unqualified
    expect(edge(index, 'Billing/Invoicing/InvoiceCalculator.cs', 'Billing/Auditor.cs')).toBeDefined();
  });

  it('resolves types made visible by a project-wide global using', () => {
    // Invoice.Total is Money (Billing.Common) — only GlobalUsings.cs imports it
    const e = edge(index, 'Billing/Invoicing/Invoice.cs', 'Billing/Common/Money.cs');
    expect(e).toBeDefined();
    expect(e!.importedNames).toContain('Money');
  });

  it('resolves alias and using-static directives', () => {
    // using Fmt = Billing.Common.Money / using static Billing.Auditor
    expect(edge(index, 'Reporting/ReportBuilder.cs', 'Billing/Common/Money.cs')).toBeDefined();
    expect(edge(index, 'Reporting/ReportBuilder.cs', 'Billing/Auditor.cs')).toBeDefined();
  });

  it('resolves fully qualified cross-project references', () => {
    // StatusReport returns Billing.Invoicing.InvoiceStatus
    const e = edge(index, 'Reporting/ReportBuilder.cs', 'Billing/Invoicing/Invoice.cs');
    expect(e).toBeDefined();
    expect(e!.importedNames).toContain('InvoiceStatus');
  });

  it('does not resolve internal types across project boundaries', () => {
    // RoundingPolicy is internal to Billing; Reporting references it but
    // gets no edge — internal means assembly-scoped.
    const e = edge(index, 'Reporting/ReportBuilder.cs', 'Billing/Common/Money.cs');
    expect(e!.importedNames).not.toContain('RoundingPolicy');
  });

  it('skips ambiguous names instead of guessing', () => {
    // CustomerSync sees Customer from both Billing.Models and Billing.Legacy
    expect(edge(index, 'Billing/CustomerSync.cs', 'Billing/Models/Customer.cs')).toBeUndefined();
    expect(edge(index, 'Billing/CustomerSync.cs', 'Billing/Legacy/Customer.cs')).toBeUndefined();
    expect(index.stats.ambiguousRefs).toBeGreaterThan(0);
  });

  it('indexes declarations with kind, namespace, and visibility', () => {
    const money = index.declarations.find((d) => d.name === 'Money');
    expect(money).toMatchObject({ kind: 'struct', namespace: 'Billing.Common', visibility: 'public' });
    const rounding = index.declarations.find((d) => d.name === 'RoundingPolicy');
    expect(rounding).toMatchObject({ visibility: 'internal' });
    const status = index.declarations.find((d) => d.name === 'InvoiceStatus');
    expect(status).toMatchObject({ kind: 'enum', enumMembers: ['Draft', 'Sent', 'Paid'] });
  });
});
