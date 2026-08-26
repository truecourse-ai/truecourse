/**
 * The WORKSPACE corpus (Knowledge): spec documents that came from connected
 * tools (Confluence pages, Jira epics), shared by every repository, in the exact
 * `SpecCorpusResponse` shape the corpus components consume, each doc carrying
 * the ledger's title and deep link and `layer: 'workspace'`. Read through a
 * workspace `SpecSource`; an enterprise entitlement in the product.
 */

import type { SpecCorpusResponse } from '@/preview/vendor/lib/api';

export interface KnowledgeDoc {
  ref: string;
  title: string;
  url: string;
  sourceKind: 'confluence' | 'jira';
  area: string;
  lastSyncedAt: string;
  body: string;
}

export const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  {
    ref: 'confluence/PAY/refund-policy',
    title: 'Refund policy (company-wide)',
    url: 'https://acme.atlassian.net/wiki/spaces/PAY/pages/1182/Refund+policy',
    sourceKind: 'confluence',
    area: 'Refunds',
    lastSyncedAt: '2026-08-21T08:10:00.000Z',
    body: [
      '# Refund policy (company-wide)',
      '',
      'The rules every product follows when money goes back to a customer.',
      '',
      '## Who may refund',
      '',
      '- A support agent may refund any order up to 500 without approval.',
      '- Above 500 a team lead approves, and the reason is recorded.',
      '',
      '## Refund windows',
      '',
      '- A refund can be requested within 30 days of delivery.',
      '- Disputed orders wait for the dispute to settle before any refund.',
    ].join('\n'),
  },
  {
    ref: 'confluence/PAY/payment-providers',
    title: 'Payment providers and limits',
    url: 'https://acme.atlassian.net/wiki/spaces/PAY/pages/1407/Payment+providers',
    sourceKind: 'confluence',
    area: 'Refunds',
    lastSyncedAt: '2026-08-20T17:45:00.000Z',
    body: [
      '# Payment providers and limits',
      '',
      '## Stripe',
      '',
      '- A partial refund may be any amount up to the captured amount.',
      '- Refunds older than 90 days are refused by the provider.',
    ].join('\n'),
  },
  {
    ref: 'confluence/ORD/order-states',
    title: 'Order states and transitions',
    url: 'https://acme.atlassian.net/wiki/spaces/ORD/pages/221/Order+states',
    sourceKind: 'confluence',
    area: 'Orders',
    lastSyncedAt: '2026-08-19T12:00:00.000Z',
    body: [
      '# Order states and transitions',
      '',
      '## Draft',
      '',
      '- A draft expires 30 minutes after its last edit.',
      '',
      '## Shipped',
      '',
      '- A shipped order cannot be cancelled; it can only be returned.',
    ].join('\n'),
  },
  {
    ref: 'jira/PAY-1180',
    title: 'PAY-1180 Partial capture refunds must return the captured amount',
    url: 'https://acme.atlassian.net/browse/PAY-1180',
    sourceKind: 'jira',
    area: 'Refunds',
    lastSyncedAt: '2026-08-21T06:30:00.000Z',
    body: [
      '# PAY-1180 Partial capture refunds must return the captured amount',
      '',
      '## Acceptance criteria',
      '',
      '- Refunding a partially captured order returns the captured amount, never the order total.',
      '- The API answers 409 when the captured amount is already refunded.',
    ].join('\n'),
  },
  {
    ref: 'jira/CAT-77',
    title: 'CAT-77 Catalog export streams over 10000 rows',
    url: 'https://acme.atlassian.net/browse/CAT-77',
    sourceKind: 'jira',
    area: 'Catalog',
    lastSyncedAt: '2026-08-18T09:00:00.000Z',
    body: [
      '# CAT-77 Catalog export streams over 10000 rows',
      '',
      '## Acceptance criteria',
      '',
      '- An export of more than 10000 rows streams and never buffers the whole file.',
    ].join('\n'),
  },
];

const AREA_ID: Record<string, string> = { Refunds: 'acme/refunds', Orders: 'acme/orders', Catalog: 'acme/catalog' };

export function knowledgeCorpusResponse(): SpecCorpusResponse {
  const areas = [...new Set(KNOWLEDGE_DOCS.map((d) => d.area))];
  return {
    corpus: {
      version: 3,
      generatedAt: '2026-08-21T08:12:00.000Z',
      docs: KNOWLEDGE_DOCS.map((d) => ({
        ref: d.ref,
        kind: 'spec',
        lastTouched: d.lastSyncedAt,
        areaTags: [AREA_ID[d.area] ?? d.area.toLowerCase()],
        layer: 'workspace' as const,
        title: d.title,
        url: d.url,
      })),
      areas: areas.map((area) => ({
        id: AREA_ID[area] ?? area.toLowerCase(),
        product: 'acme',
        concern: area.toLowerCase(),
        docRefs: KNOWLEDGE_DOCS.filter((d) => d.area === area).map((d) => d.ref),
        overlaps:
          area === 'Refunds'
            ? [
                {
                  docs: ['confluence/PAY/refund-policy', 'confluence/PAY/payment-providers'],
                  note: 'Refund window: 30 days after delivery, or the provider limit of 90 days',
                  review: {
                    explanation:
                      'The company policy promises a refund within 30 days of delivery. The providers page states the provider refuses refunds older than 90 days, which reads as the window itself.',
                    recommendation: {
                      action: 'pick-a',
                      rationale: 'The policy page is the product rule; the providers page states a provider limit, not a promise.',
                    },
                  },
                  sections: [
                    { doc: 'confluence/PAY/refund-policy', heading: 'Refund windows', quote: 'A refund can be requested within 30 days of delivery.' },
                    { doc: 'confluence/PAY/payment-providers', heading: 'Stripe', quote: 'Refunds older than 90 days are refused by the provider.' },
                  ],
                  areas: [AREA_ID.Refunds!],
                },
              ]
            : [],
      })),
      skippedDocs: [
        { ref: 'confluence/PAY/team-oncall-rota', reason: 'operations, not product behavior' },
        { ref: 'jira/PAY-1201', reason: 'a bug report, not a requirement' },
      ],
    },
    manualIncludes: [],
    manualExcludes: [],
    conflictResolutions: [],
  };
}

export function knowledgeDocByRef(ref: string): KnowledgeDoc | undefined {
  return KNOWLEDGE_DOCS.find((d) => d.ref === ref);
}
