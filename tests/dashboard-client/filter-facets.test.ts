/**
 * The two counts beside a filter's values.
 *
 * `count` answers "how many rows do I get if I pick this", so it is computed
 * over the rows the search and the OTHER dimensions already keep. `total`
 * answers "how many rows does this value keep on its own", over the full set,
 * which is what an applied pill says. What is asserted here is that reading: a
 * selection moves every other dimension's counts and never its own, the search
 * moves all of them, a value's own size moves with neither, and a value nothing
 * in the FULL set carries is dropped rather than shown as a zero.
 */

import { describe, expect, it } from 'vitest';
import { facetDimensions, type FacetDimension } from '@/preview/ui/filter-facets';

interface Row {
  title: string;
  status: 'failed' | 'blocked' | 'passed';
  repo: 'web' | 'api';
  drivers: string[];
}

const ROWS: Row[] = [
  { title: 'checkout', status: 'failed', repo: 'web', drivers: ['web'] },
  { title: 'refund', status: 'passed', repo: 'web', drivers: ['web', 'api'] },
  { title: 'invoice', status: 'failed', repo: 'api', drivers: ['api'] },
  { title: 'payout', status: 'passed', repo: 'api', drivers: ['api'] },
  { title: 'dispute', status: 'blocked', repo: 'api', drivers: [] },
];

const DIMENSIONS: FacetDimension<Row>[] = [
  {
    key: 'status',
    label: 'Status',
    valuesOf: (row) => [row.status],
    values: [
      { value: 'failed', label: 'Failed' },
      { value: 'blocked', label: 'Blocked' },
      { value: 'passed', label: 'Passed' },
      { value: 'skipped', label: 'Skipped' },
    ],
    hideEmpty: true,
  },
  {
    key: 'repo',
    label: 'Repository',
    valuesOf: (row) => [row.repo],
    values: [
      { value: 'web', label: 'acme/web' },
      { value: 'api', label: 'acme/api' },
    ],
  },
  {
    key: 'driver',
    label: 'Driver',
    valuesOf: (row) => row.drivers,
    values: [
      { value: 'web', label: 'Web' },
      { value: 'api', label: 'API' },
    ],
  },
];

/** The counts of one dimension, by value, as the menu would show them. */
function counts(dimensions: ReturnType<typeof facetDimensions>, key: string) {
  const dimension = dimensions.find((d) => d.key === key)!;
  return Object.fromEntries(
    dimension.options.map((option) => [option.key.slice(key.length + 1), option.count]),
  );
}

/** The same values' own sizes, as an applied pill would say them. */
function totals(dimensions: ReturnType<typeof facetDimensions>, key: string) {
  const dimension = dimensions.find((d) => d.key === key)!;
  return Object.fromEntries(
    dimension.options.map((option) => [option.key.slice(key.length + 1), option.total]),
  );
}

const facets = (selected: string[], matches?: (row: Row) => boolean) =>
  facetDimensions<Row>({
    rows: ROWS,
    dimensions: DIMENSIONS,
    selected,
    ...(matches ? { matches } : {}),
  });

describe('faceted filter counts', () => {
  it('counts every row when nothing is selected', () => {
    const dimensions = facets([]);
    expect(counts(dimensions, 'status')).toEqual({ failed: 2, blocked: 1, passed: 2 });
    expect(counts(dimensions, 'repo')).toEqual({ web: 2, api: 3 });
    // A row may carry several values of one dimension, and one carries none.
    expect(counts(dimensions, 'driver')).toEqual({ web: 2, api: 3 });
  });

  it('narrows every other dimension by a selection, and never the selected one', () => {
    const dimensions = facets(['repo:api']);
    expect(counts(dimensions, 'status')).toEqual({ failed: 1, blocked: 1, passed: 1 });
    expect(counts(dimensions, 'driver')).toEqual({ web: 0, api: 2 });
    // The dimension the reader picked in keeps its own counts: acme/web is what
    // swapping to it would give, and acme/api never shrinks to itself.
    expect(counts(dimensions, 'repo')).toEqual({ web: 2, api: 3 });
  });

  it('reads OR within one dimension and AND across two', () => {
    expect(counts(facets(['status:failed', 'status:passed']), 'repo')).toEqual({ web: 2, api: 2 });
    expect(counts(facets(['status:failed', 'driver:api']), 'repo')).toEqual({ web: 0, api: 1 });
  });

  it('narrows the counts by the search too', () => {
    const dimensions = facets([], (row) => row.title.startsWith('p'));
    expect(counts(dimensions, 'status')).toEqual({ failed: 0, blocked: 0, passed: 1 });
    expect(counts(dimensions, 'repo')).toEqual({ web: 0, api: 1 });
  });

  it('keeps a value the full set carries and drops one it does not', () => {
    // `skipped` is nobody's status, so it is never offered; `failed` is offered
    // with the zero its narrowing left it, because the list does hold failures.
    const dimensions = facets(['repo:web', 'driver:api']);
    expect(counts(dimensions, 'status')).toEqual({ failed: 0, blocked: 0, passed: 1 });
    expect(counts(facets([]), 'status')).not.toHaveProperty('skipped');
  });

  it('keys every option by its dimension and value', () => {
    const dimensions = facets([]);
    expect(dimensions.map((d) => d.label)).toEqual(['Status', 'Repository', 'Driver']);
    expect(dimensions[1]!.options).toEqual([
      { key: 'repo:web', label: 'acme/web', count: 2, total: 2 },
      { key: 'repo:api', label: 'acme/api', count: 3, total: 3 },
    ]);
  });

  it('keeps each value’s own size out of the narrowing, for the applied pill', () => {
    // The pill of an applied filter says what that filter alone keeps, so it
    // never collapses to the intersection the tally already shows.
    const dimensions = facets(['repo:api', 'status:failed'], (row) => row.title !== 'payout');
    expect(counts(dimensions, 'status')).toEqual({ failed: 1, blocked: 1, passed: 0 });
    expect(totals(dimensions, 'status')).toEqual({ failed: 2, blocked: 1, passed: 2 });
    expect(totals(dimensions, 'repo')).toEqual({ web: 2, api: 3 });
    // A row carrying several values of one dimension counts once in each.
    expect(totals(dimensions, 'driver')).toEqual({ web: 2, api: 3 });
  });
});
