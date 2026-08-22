// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * The spec corpus beside the coverage: the documents the scan kept, grouped by
 * area, each with the sections that state claims, and the open conflicts
 * between sections. The Coverage tab lists these on the left and reads one on
 * the right. Hand-written for orders-api; the other repos derive one document
 * per area from their tests, so every repo has a corpus to browse.
 */

import type { TestStatus } from './types';
import { OTHER_REPO_GUARD } from './other-repos';

export interface SpecSection {
  id: string;
  heading: string;
  /** How many claims the section states. */
  claims: number;
  /** The section's coverage status, aggregated from the tests that prove it. */
  status: TestStatus;
  /** Test ids that prove this section's claims. */
  tests: string[];
  /** Why a blocked or not-testable section is not proven. */
  reason?: string;
}

export interface SpecDoc {
  id: string;
  path: string;
  title: string;
  area: string;
  /** Where the document came from: the repository tree or an llms.txt site. */
  origin: 'repo' | 'site';
  sections: SpecSection[];
}

export interface SpecConflict {
  id: string;
  area: string;
  title: string;
  /** The two sides: a document section each, with the claim it states. */
  sides: { docId: string; section: string; claim: string }[];
  recommendation: { side: 0 | 1; why: string; confidence: 'high' | 'medium' | 'low' };
  status: 'open' | 'resolved';
  /** What the resolver chose, when resolved. */
  resolution?: string;
}

export const ORDERS_API_DOCS: SpecDoc[] = [
  {
    id: 'doc-orders-lifecycle',
    path: 'docs/orders/lifecycle.md',
    title: 'Order lifecycle',
    area: 'Orders',
    origin: 'repo',
    sections: [
      { id: 'creating-an-order', heading: 'Creating an order', claims: 4, status: 'failing', tests: ['oa-expired-card', 'oa-reserve-stock'] },
      { id: 'approval', heading: 'Approval above the account limit', claims: 2, status: 'passing', tests: ['oa-approval-limit'] },
      { id: 'cancellation', heading: 'Cancellation', claims: 3, status: 'passing', tests: ['oa-cancel-shipped'] },
      { id: 'drafts', heading: 'Draft orders', claims: 2, status: 'passing', tests: ['oa-draft-expiry'] },
    ],
  },
  {
    id: 'doc-orders-notifications',
    path: 'docs/orders/notifications.md',
    title: 'Order notifications',
    area: 'Orders',
    origin: 'repo',
    sections: [
      {
        id: 'confirmation-email',
        heading: 'Confirmation e-mail',
        claims: 3,
        status: 'blocked',
        tests: ['oa-pickup-email'],
        reason: 'Needs the supplied SMTP sink; no values stored yet.',
      },
      { id: 'shipping-updates', heading: 'Shipping updates', claims: 2, status: 'never-run', tests: [] },
    ],
  },
  {
    id: 'doc-orders-import',
    path: 'docs/orders/bulk-import.md',
    title: 'Bulk order import',
    area: 'Orders',
    origin: 'repo',
    sections: [
      { id: 'file-format', heading: 'File format', claims: 3, status: 'passing', tests: ['oa-import-missing-sku'] },
      { id: 'partial-failures', heading: 'Partial failures', claims: 2, status: 'never-run', tests: [] },
    ],
  },
  {
    id: 'doc-refunds',
    path: 'docs/payments/refunds.md',
    title: 'Refunds',
    area: 'Refunds',
    origin: 'repo',
    sections: [
      { id: 'partial-capture', heading: 'Refunding a partially captured order', claims: 3, status: 'failing', tests: ['oa-partial-capture-refund'] },
      { id: 'idempotency', heading: 'Idempotency', claims: 2, status: 'passing', tests: ['oa-refund-idempotent'] },
      { id: 'limits', heading: 'Limits and reasons', claims: 3, status: 'passing', tests: ['oa-refund-over-capture', 'oa-refund-reason'] },
      {
        id: 'disputes',
        heading: 'Disputed orders',
        claims: 2,
        status: 'blocked',
        tests: ['oa-refund-disputed'],
        reason: 'The dispute webhook needs the supplied Stripe account.',
      },
    ],
  },
  {
    id: 'doc-refund-policy',
    path: 'docs/policies/refund-policy.md',
    title: 'Refund policy',
    area: 'Refunds',
    origin: 'repo',
    sections: [
      { id: 'customer-view', heading: 'What the customer sees', claims: 2, status: 'failing', tests: ['oa-refund-on-order-page'] },
      { id: 'windows', heading: 'Refund windows', claims: 3, status: 'never-run', tests: [] },
    ],
  },
  {
    id: 'doc-catalog-products',
    path: 'docs/catalog/products.md',
    title: 'Products',
    area: 'Catalog',
    origin: 'repo',
    sections: [
      { id: 'publishing', heading: 'Publishing', claims: 2, status: 'passing', tests: ['oa-publish-no-price'] },
      { id: 'archiving', heading: 'Archiving', claims: 2, status: 'passing', tests: ['oa-archive-hides'] },
      { id: 'localized-prices', heading: 'Localized prices', claims: 3, status: 'passing', tests: ['oa-localized-price'] },
      { id: 'search', heading: 'Search', claims: 2, status: 'passing', tests: ['oa-search-by-sku'] },
    ],
  },
  {
    id: 'doc-catalog-import-export',
    path: 'docs/catalog/import-export.md',
    title: 'Catalog import and export',
    area: 'Catalog',
    origin: 'repo',
    sections: [
      {
        id: 'incremental-import',
        heading: 'Incremental import',
        claims: 2,
        status: 'not-testable',
        tests: ['oa-import-changed-only'],
        reason: 'The claim names a wall-clock window no sandbox can arrange.',
      },
      { id: 'export', heading: 'Export', claims: 2, status: 'never-run', tests: ['oa-export-streaming'] },
      { id: 'bulk-price-change', heading: 'Bulk price change', claims: 2, status: 'passing', tests: ['oa-bulk-price-change'] },
    ],
  },
  {
    id: 'doc-stripe-refunds',
    path: 'sources/stripe-docs/refunds.md',
    title: 'Stripe: Refunds',
    area: 'Refunds',
    origin: 'site',
    sections: [
      { id: 'stripe-partial', heading: 'Partial refunds', claims: 2, status: 'passing', tests: ['oa-partial-capture-refund'] },
      { id: 'stripe-timing', heading: 'Timing', claims: 1, status: 'never-run', tests: [] },
    ],
  },
];

export const ORDERS_API_CONFLICTS: SpecConflict[] = [
  {
    id: 'conf-refund-window',
    area: 'Refunds',
    title: 'Refund window: 30 days or 14 days',
    sides: [
      { docId: 'doc-refund-policy', section: 'Refund windows', claim: 'A refund can be requested within 30 days of delivery.' },
      { docId: 'doc-refunds', section: 'Limits and reasons', claim: 'Refund requests older than 14 days are refused by the API.' },
    ],
    recommendation: {
      side: 1,
      why: 'The API doc is newer (edited 2 weeks ago) and the policy page has not changed since launch.',
      confidence: 'high',
    },
    status: 'open',
  },
  {
    id: 'conf-partial-refund-amount',
    area: 'Refunds',
    title: 'Partial refund: captured amount or order total',
    sides: [
      { docId: 'doc-refunds', section: 'Refunding a partially captured order', claim: 'The refund returns the captured amount, never the order total.' },
      { docId: 'doc-stripe-refunds', section: 'Partial refunds', claim: 'A refund may be any amount up to the original charge.' },
    ],
    recommendation: {
      side: 0,
      why: 'The site page states the payment provider limit; the repository doc states the product rule, which is stricter.',
      confidence: 'medium',
    },
    status: 'open',
  },
  {
    id: 'conf-draft-expiry',
    area: 'Orders',
    title: 'Draft expiry: 30 minutes or 1 hour',
    sides: [
      { docId: 'doc-orders-lifecycle', section: 'Draft orders', claim: 'A draft expires 30 minutes after its last edit.' },
      { docId: 'doc-orders-notifications', section: 'Shipping updates', claim: 'Drafts are kept for an hour so the reminder e-mail can link to them.' },
    ],
    recommendation: { side: 0, why: 'The lifecycle doc is the source the notifications doc cites.', confidence: 'high' },
    status: 'resolved',
    resolution: 'Kept the lifecycle doc; the notifications claim is suppressed at generate.',
  },
];

/** One document per area for the repos without a hand-written corpus. */
function derivedDocs(slug: string): SpecDoc[] {
  const guard = OTHER_REPO_GUARD[slug];
  if (!guard) return [];
  return guard.areas.map((area) => {
    const tests = guard.tests.filter((t) => t.area === area);
    return {
      id: `doc-${slug}-${area.toLowerCase()}`,
      path: `docs/${area.toLowerCase()}.md`,
      title: area,
      area,
      origin: 'repo' as const,
      sections: tests.map((t) => ({
        id: t.id,
        heading: t.flow,
        claims: 1 + (t.steps.length % 3),
        status: t.status,
        tests: [t.id],
        reason: t.reason,
      })),
    };
  });
}

const DOCS_BY_REPO: Record<string, SpecDoc[]> = {
  'orders-api': ORDERS_API_DOCS,
  'web-console': derivedDocs('web-console'),
  billing: derivedDocs('billing'),
  'devops-tools': derivedDocs('devops-tools'),
};

const CONFLICTS_BY_REPO: Record<string, SpecConflict[]> = {
  'orders-api': ORDERS_API_CONFLICTS,
  'web-console': [],
  billing: [
    {
      id: 'conf-billing-proration',
      area: 'Subscriptions',
      title: 'Proration on downgrade: immediate or next cycle',
      sides: [
        { docId: 'doc-billing-subscriptions', section: 'Downgrades', claim: 'A downgrade is prorated immediately.' },
        { docId: 'doc-billing-invoices', section: 'Invoice lines', claim: 'Plan changes appear on the next invoice only.' },
      ],
      recommendation: { side: 1, why: 'The invoices doc was edited after the subscriptions doc.', confidence: 'low' },
      status: 'open',
    },
  ],
  'devops-tools': [],
};

export function docsForRepo(slug: string): SpecDoc[] {
  return DOCS_BY_REPO[slug] ?? [];
}

export function conflictsForRepo(slug: string): SpecConflict[] {
  return CONFLICTS_BY_REPO[slug] ?? [];
}

// ---------------------------------------------------------------------------
// Coverage VERSIONS (ONE_PRODUCT_PLAN §3.5, the agentic plan's §3.8): every scan
// writes a version parented on the one before; a pull request that edits spec
// documents gets its own version parented on the baseline, and a run names the
// version it executed. A version carries its CHANGES against its parent; the
// corpus as of that version is the parent's corpus with the changes applied.
// ---------------------------------------------------------------------------

export type DocChange = 'added' | 'edited' | 'removed';

export interface CoverageVersion {
  id: string;
  /** The picker's word: `main` for the baseline, `#486` for a pull request's version. */
  label: string;
  parentId: string | null;
  ref: string;
  sha: string;
  createdAt: string;
  pullRequest?: number;
  changes: {
    docs: { ref: string; change: DocChange; sections?: string[] }[];
    conflicts: { id: string; change: 'opened' | 'resolved' }[];
  };
  /** Scenarios exist for this version. A PR version waits for regenerate until they do. */
  generated: boolean;
}

const VERSIONS_BY_REPO: Record<string, CoverageVersion[]> = {
  'orders-api': [
    {
      id: 'v-oa-main-4d80ec9',
      label: 'main',
      parentId: null,
      ref: 'main',
      sha: '4d80ec9',
      createdAt: '1 hour ago',
      changes: { docs: [], conflicts: [] },
      generated: true,
    },
    {
      id: 'v-oa-pr486-a19c204',
      label: '#486',
      parentId: 'v-oa-main-4d80ec9',
      ref: 'docs/refund-wording',
      sha: 'a19c204',
      createdAt: '3 hours ago',
      pullRequest: 486,
      changes: {
        docs: [
          { ref: 'docs/policies/refund-policy.md', change: 'edited', sections: ['Refund windows', 'What the customer sees'] },
          { ref: 'docs/payments/refunds.md', change: 'edited', sections: ['Refunding a partially captured order'] },
          { ref: 'docs/payments/refund-disputes.md', change: 'added' },
        ],
        conflicts: [{ id: 'conf-refund-window', change: 'resolved' }],
      },
      generated: false,
    },
  ],
  'web-console': [
    {
      id: 'v-wc-main-9d20b41',
      label: 'main',
      parentId: null,
      ref: 'main',
      sha: '9d20b41',
      createdAt: '2 days ago',
      changes: { docs: [], conflicts: [] },
      generated: true,
    },
  ],
  billing: [
    {
      id: 'v-bl-main-6c02da9',
      label: 'main',
      parentId: null,
      ref: 'main',
      sha: '6c02da9',
      createdAt: '40 minutes ago',
      changes: { docs: [], conflicts: [] },
      generated: false,
    },
  ],
  'devops-tools': [
    {
      id: 'v-dt-main-4b1e77c',
      label: 'main',
      parentId: null,
      ref: 'main',
      sha: '4b1e77c',
      createdAt: 'yesterday',
      changes: { docs: [], conflicts: [] },
      generated: true,
    },
  ],
};

/** A repo's versions, the baseline first. */
export function coverageVersions(repoId: string): CoverageVersion[] {
  return VERSIONS_BY_REPO[repoId] ?? [];
}

export function coverageVersionById(repoId: string, id: string | null | undefined): CoverageVersion | undefined {
  const versions = coverageVersions(repoId);
  return (id ? versions.find((v) => v.id === id) : undefined) ?? versions[0];
}

/** The documents as of a version: the baseline corpus with the version's changes applied. */
export function docsAtVersion(repoId: string, version: CoverageVersion | undefined): SpecDoc[] {
  const base = docsForRepo(repoId);
  if (!version || version.parentId === null) return base;
  const removed = new Set(version.changes.docs.filter((c) => c.change === 'removed').map((c) => c.ref));
  const docs = base.filter((d) => !removed.has(d.path));
  for (const c of version.changes.docs) {
    if (c.change !== 'added' || docs.some((d) => d.path === c.ref)) continue;
    const title = c.ref.split('/').pop()!.replace(/\.md$/, '').replace(/-/g, ' ');
    docs.push({
      id: `doc-${version.id}-${title.replace(/\s+/g, '-')}`,
      path: c.ref,
      title: title.replace(/^./, (ch) => ch.toUpperCase()),
      area: docs.find((d) => d.path.startsWith(c.ref.split('/').slice(0, -1).join('/')))?.area ?? 'Refunds',
      origin: 'repo',
      sections: [
        { id: 'disputed-refunds', heading: 'Disputed refunds', claims: 2, status: 'never-run', tests: [] },
        { id: 'evidence-window', heading: 'Evidence window', claims: 1, status: 'never-run', tests: [] },
      ],
    });
  }
  return docs;
}

/** The conflicts as of a version: the baseline set with the version's resolutions applied. */
export function conflictsAtVersion(repoId: string, version: CoverageVersion | undefined): SpecConflict[] {
  const base = conflictsForRepo(repoId);
  if (!version || version.parentId === null) return base;
  return base.map((c) => {
    const change = version.changes.conflicts.find((x) => x.id === c.id);
    if (!change || change.change !== 'resolved') return c;
    return { ...c, status: 'resolved', resolution: `Settled by the wording change in ${version.label}.` };
  });
}
