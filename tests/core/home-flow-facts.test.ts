/**
 * Home's flow facts: what the flows' own tests say, folded into the findings,
 * the things blocked flows wait on, and each document's flows.
 */
import { describe, expect, it } from 'vitest';
import { composeHomeFlowFacts, type HomeFlowRow } from '../../packages/core/src/services/home/index';

const row = (over: Partial<HomeFlowRow> & Pick<HomeFlowRow, 'flowId' | 'status'>): HomeFlowRow => ({
  title: over.flowId,
  docs: ['docs/app.md'],
  ...over,
});

describe('Home flow facts', () => {
  it('folds findings, blocked-on groups and per-document counts from the flows', () => {
    const facts = composeHomeFlowFacts({
      repos: [
        {
          repository: 'acme/penny',
          sections: new Map(),
          flows: [],
          history: [],
          flowRows: {
            repoId: 'penny',
            items: [
              row({
                flowId: 'edit-expense',
                status: 'failed',
                docs: ['docs/requirements.md'],
                finding: { documented: 'Editing opens a page.', observed: 'Editing opens a dialog.' },
              }),
              row({ flowId: 'convert', status: 'blocked', blockedOn: 'CurrencyBeacon API key' }),
              row({ flowId: 'convert-twice', status: 'blocked', blockedOn: 'CurrencyBeacon API key' }),
              row({ flowId: 'empty-ledger', status: 'blocked', blockedOn: 'A product no other test is using' }),
              row({ flowId: 'open-expense', status: 'succeeded' }),
            ],
          },
        },
      ],
    });

    expect(facts.findings).toEqual([
      {
        id: 'acme/penny:edit-expense',
        title: 'edit-expense',
        documented: 'Editing opens a page.',
        observed: 'Editing opens a dialog.',
        href: '/flows/edit-expense?repo=penny',
      },
    ]);
    // Most flows first.
    expect(facts.blockedOn.map((b) => [b.reason, b.flows])).toEqual([
      ['CurrencyBeacon API key', 2],
      ['A product no other test is using', 1],
    ]);
    // Worst share first: the document whose every flow fails leads.
    expect(facts.documents.map((d) => [d.doc, d.total, d.byStatus.failed, d.byStatus.blocked, d.byStatus.succeeded])).toEqual([
      ['docs/requirements.md', 1, 1, 0, 0],
      ['docs/app.md', 4, 0, 3, 1],
    ]);
    expect(facts.documents[0].href).toBe('/flows?doc=docs%2Frequirements.md');
  });
});
